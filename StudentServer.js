const express = require("express");
const crypto = require("crypto");
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const { Parser } = require("json2csv");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());


// Password encryption

function encryptPassword(plaintext, key, iv) {
    const cipher = crypto.createCipheriv(
        "aes-128-cbc",
        Buffer.from(key, "utf8"),
        Buffer.from(iv, "utf8")
    );
    let encrypted = cipher.update(plaintext, "utf8", "base64");
    encrypted += cipher.final("base64");
    return encrypted;
}


let browser = null;


// Browser is global



async function loginAndGetFrame(student_id, password) {
    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-zygote"
        ]
        });
    const page = await browser.newPage();
    try{
    await page.goto(
  "https://webprosindia.com/vignanit/default.aspx",
  {
    waitUntil: "domcontentloaded", // NOT networkidle2
    timeout: 60000
  }
);


    const html = await page.content();
    const $ = cheerio.load(html);

    const viewstate = $("input[name='__VIEWSTATE']").val();
    const viewstateGenerator = $("input[name='__VIEWSTATEGENERATOR']").val();
    const eventValidation = $("input[name='__EVENTVALIDATION']").val();

    if (!viewstate || !viewstateGenerator || !eventValidation) {
        await browser.close();
        browser = null;

        return { error: "Failed to extract login form data" };
    }

    

    const key = "8701661282118308";
    const iv = "8701661282118308";
    const encryptedPassword = encryptPassword(password, key, iv);

    await page.type("#txtId2", student_id);
    await page.type("#txtPwd2", password);

    await page.evaluate((encPwd) => {
    document.querySelector("#hdnpwd2").value = encPwd;
    }, encryptedPassword);

    await Promise.all([
        page.click("#imgBtn2"),
        page.waitForNavigation({ waitUntil: "networkidle2" })
    ]);

    // go to StudentMaster page
        await page.goto(
        "https://webprosindia.com/vignanit/StudentMaster.aspx",
        { waitUntil: "networkidle2" }
    );
}
    catch (err) {
  console.error("loginAndGetFrame error:", err.message);

  // Always clean up Puppeteer
  try {
    await page.close();
    await browser.close();
  } catch (_) {}

  // IMPORTANT: rethrow the error
  throw err;
}

    

    return { page };

}



function periodsToReach75(present, total) {
  const target = 0.75;

  if (present / total >= target) {
    return 0;
  }

  const x = Math.ceil((target * total - present) / (1 - target));
  return x;
}


function periodsToDays( periods, periodsPerDay = 7) {
  return Math.ceil(periods / periodsPerDay);
}


function periodsCanBunk(present, total) {
  const target = 0.75;

  if (present / total < target) {
    return 0;
  }

  const x = Math.floor((present - target * total) / target);
  return x;
}



// http://localhost:3000/get_today_attedence?student_id=24l35a4306&password=02092005
app.post("/get_today_attedence", async (req, res) => {
  try {
    const { student_id, password} = req.body;



    if (!student_id || !password) {
      return res.status(400).json({
        error: "student_id and password are required"
      });
    }

    const { page } = await loginAndGetFrame(student_id, password);

    await page.waitForSelector("#tblscreens", { timeout: 30000 });

    const clicked = await page.evaluate(() => {
      const links = document.querySelectorAll("#tblscreens a.menuLink");

      for (let i = 0; i < links.length; i++) {
        if (links[i].innerText.trim().toUpperCase() === "ACADAMIC REGISTER") {
          links[i].click();
          return true;
        }
      }
      return false;
    });

    if (!clicked) {
      throw new Error("ACADEMIC REGISTER menu not found");
    }

    const frameHandle = await page.waitForSelector(
      "iframe#capIframeId",
      { timeout: 30000 }
    );

    const frame = await frameHandle.contentFrame();

    // wait for register content inside iframe
    await frame.waitForSelector(
      "#ctl00_CapPlaceHolder_divRegister",
      { timeout: 30000 }
    );


    const todayAttendance = await frame.evaluate(() => {
  const result = [];

  const outerTable = document.querySelector("#tblReport table");
  if (!outerTable) return { error: "Outer table not found" };

  const rows = Array.from(outerTable.querySelectorAll("tr"));

  // find the header row that contains dates like DD/MM
  let headerRow = null;

  for (const row of rows) {
    const tds = Array.from(row.querySelectorAll("td"));
    if (tds.some(td => /\d{2}\/\d{2}/.test(td.innerText.trim()))) {
      headerRow = row;
      break;
    }
  }

  if (!headerRow) {
    return { error: "Header row not found" };
  }

  const headerCells = Array.from(headerRow.querySelectorAll("td"));

  const today = new Date();
  const todayStr =
    String(today.getDate()).padStart(2, "0") +
    "/" +
    String(today.getMonth() + 1).padStart(2, "0");

  let todayIndex = -1;

  headerCells.forEach((td, i) => {
    if (td.innerText.trim() === todayStr) {
      todayIndex = i;
    }
  });

  if (todayIndex === -1) {
    return { error: "Today column not found", todayStr };
  }

  // subject rows come AFTER headerRow
  const headerRowIndex = rows.indexOf(headerRow);

  for (let i = headerRowIndex + 1;  i < rows.length; i++) {
    const cells = rows[i].querySelectorAll("td");
    if (cells.length <= todayIndex) continue;

    const subject = cells[1]?.innerText.trim();
    const status = cells[todayIndex - 1]?.innerText.trim();


    if (subject && status != "-") {
      result.push({
        subject,
        status // P / A / -
      });
    }
  }

  return result;
});
let formattedText
if ( todayAttendance.error){
  formattedText = "There is no Attedence Today"
}
else{
  formattedText = todayAttendance
  .filter(item => item.subject !== "Subject") // remove header row
  .map(item => {
    return `${item.subject.padEnd(12)} : ${item.status}`;
  })
  .join("\n");
}



  console.log(formattedText);

res.json({ success: true, formattedText });





}
    catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }

  finally {
    // 🔥 THIS IS THE CORRECT PLACE 🔥
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
});



// http://localhost:3000/get_attedence?student_id=24l35a4306&password=02092005
app.post("/get_attedence", async (req, res) => {
  try {
    const { student_id, password} = req.body;



    if (!student_id || !password) {
      return res.status(400).json({
        error: "student_id and password are required"
      });
    }

    const { page } = await loginAndGetFrame(student_id, password);

    // ✅ Wait for iframe properly
    const frameHandle = await page.waitForSelector(
      "iframe#capIframeId",
      { timeout: 30000 }
    );

    const frame = await frameHandle.contentFrame();

    // ✅ Wait for attendance div INSIDE iframe
    await frame.waitForSelector("#divProfile_Present", { timeout: 30000 });

    // ✅ Extract attendance correctly
    const attedence = await frame.evaluate(() => {
      const table = document.querySelector("#divProfile_Present table");
      if (!table) return null;

      const tds = table.querySelectorAll("td");

      for (let i = 0; i < tds.length; i++) {
        if (tds[i].innerText.trim() === "TOTAL") {
          const classHeld = tds[i + 1]?.innerText.trim();
          const classPresent = tds[i + 2]?.innerText.trim();
          const percent = tds[i + 3]?.innerText.trim();

          return {classPresent,classHeld,percent};
        }
      }
      return null;
    });

    console.log(attedence);

    const classPresent = parseInt(attedence.classPresent);
    const classHeld = parseInt(attedence.classHeld);
    const percent = parseInt(attedence.percent);

    let textmsg;

    if ( percent >= 75){
        const days = periodsCanBunk(classPresent, classHeld);
        textmsg = "You can Skip " + days + " Periods ( " + periodsToDays(days) + " days )";
    }
        
    else
    {
        const days = periodsToReach75(classPresent, classHeld);
        textmsg = "You have to attend " + days + "(" + periodsToDays(days) + ")";
    } 

    const Responce = classPresent + "/" + classHeld + ": " + percent + "% \n\n\n\t" + textmsg;

    res.json({ success: true, Responce });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
  finally {
    // 🔥 THIS IS THE CORRECT PLACE 🔥
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});