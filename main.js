const { Builder, By, until, Key } = require('selenium-webdriver')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const chrome = require('selenium-webdriver/chrome')

// creds and stuff MUST FILL!!!!
const GEMINI_API_KEY = "GEMINIAPIKEY" // eg AIzaSyCm3k-2s....
const DISCORD_EMAIL = "YOURDISCORDEMAIL" //eg myemail@gmail.com
const DISCORD_PASSWORD = "YOURDISCORDPASSWORD" // eg mypassword123
const TARGET_DISCORD_CHANNEL_URL = 'CHANNEL/DM LINK' //eg: https://discord.com/channels/270613445177638922/1356730684957396992
const DISCORD_USERNAME_TO_AVOID_SELF_REPLY = "YOURUSERNAMEONTHESERVER/DISPLAYNAME ON THE CHAT" //eg hallworld
const CHECK_INTERVAL_MS = 5000 //check messages every
const HUMAN_LIKE_TYPING_DELAY_MIN_MS = 2000
const HUMAN_LIKE_TYPING_DELAY_MAX_MS = 4000

const WholeFunction = async () => {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" })

  let driver
  let messageCheckerInterval

  try {
    const seleniumTest = async () => {
      let lastProcessedDiscordMessageContent = null
      let lastBotMessageContentSent = null

      try {
        const options = new chrome.Options()
        // options.addArguments('--headless')

        driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build()

        console.log(`heading to discord now: ${TARGET_DISCORD_CHANNEL_URL}`)
        await driver.get(TARGET_DISCORD_CHANNEL_URL)

        try {
          console.log("looking for that annoying popup")
          const continueButton = await driver.wait(until.elementLocated(By.css("button[class*='contents__'], button[class*='anchorLink']")), 15000)
          console.log("found it clicking")
          await continueButton.click()
          await driver.wait(until.elementLocated(By.name("email")), 10000)
        } catch (e) {
          console.log("popup not there or gone already nice")
        }

        try {
          await driver.findElement(By.name("email"))

          console.log("login time")
          const emailFormDiscord = await driver.wait(until.elementLocated(By.name("email")), 10000)
          await emailFormDiscord.sendKeys(DISCORD_EMAIL)

          const passwordFormDiscord = await driver.wait(until.elementLocated(By.name("password")), 10000)
          await passwordFormDiscord.sendKeys(DISCORD_PASSWORD)

          const submitButtonDiscord = await driver.wait(until.elementLocated(By.css('button[type="submit"]')), 10000)
          await submitButtonDiscord.click()
          console.log("login sent")

          console.log("waiting for discord to load in")
          await driver.wait(until.elementLocated(By.css('div[aria-label="Servers sidebar"], nav[aria-label="Servers"]')), 60000)
          console.log("looks like it worked")

          console.log("going back to channel again")
          await driver.get(TARGET_DISCORD_CHANNEL_URL)

        } catch (e) {
          if (e.name === 'NoSuchElementError' || e.name === 'TimeoutError') {
            console.log("login not needed or failed quietly idk")
          } else {
            console.error("login broke bad:", e)
            throw e
          }
        }

        console.log("waiting for the chat box to show up")
        await driver.wait(until.elementLocated(By.css('div[role="textbox"][aria-label*="Message"]')), 30000)
        console.log("chat box is ready")

        const repeatSendMessage = async () => {
          try {
            const lastMessageDetails = await driver.executeScript(`
              const messageElements = Array.from(document.querySelectorAll('li[class*="messageListItem__"], div[class*="message__"]'))
              if (messageElements.length === 0) return null
              const lastMessageElement = messageElements[messageElements.length - 1]
              if (!lastMessageElement) return null

              const authorElement = lastMessageElement.querySelector('[id^="message-username-"], .username_c19a55, [class*="username__"]')
              const contentElement = lastMessageElement.querySelector('[id^="message-content-"], .markup__75297, [class*="messageContent__"]')
              
              const author = authorElement ? authorElement.innerText.trim() : null
              let textContent = ''
              if (contentElement) {
                Array.from(contentElement.childNodes).forEach(node => {
                  if (node.nodeType === Node.TEXT_NODE) {
                    textContent += node.textContent
                  } else if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === 'SPAN' || node.tagName === 'DIV' || node.matches('[class*="spoiler"]'))) {
                    textContent += node.innerText || node.textContent
                  }
                })
                textContent = textContent.trim().replace(/\\n/g, ' ')
              }
              return { author, text: textContent || null }
            `)

            if (!lastMessageDetails || !lastMessageDetails.text || !lastMessageDetails.author) return

            const { author: lastUser, text: currentDiscordLastMessageText } = lastMessageDetails

            if (
              currentDiscordLastMessageText === lastProcessedDiscordMessageContent ||
              lastUser.toLowerCase() === DISCORD_USERNAME_TO_AVOID_SELF_REPLY.toLowerCase() ||
              currentDiscordLastMessageText === lastBotMessageContentSent
            ) return

            console.log(`new msg from ${lastUser}: "${currentDiscordLastMessageText}"`)
            lastProcessedDiscordMessageContent = currentDiscordLastMessageText

            const prompt = `you are a super casual discord user reply to this like a chill human use no caps or punctuation make it short/medium length, try to do messages that open up a conversation!! and low effort dont be ai just vibe: "${currentDiscordLastMessageText}"`

            console.log("asking gemini for a reply")
            const result = await model.generateContent(prompt)
            const response = await result.response
            let aiResponseText = response.text().replace(/\*/g, '').toLowerCase().trim()

            if (!aiResponseText) {
              console.log("gemini gave nothing lol skip")
              return
            }

            const typingDelay = HUMAN_LIKE_TYPING_DELAY_MIN_MS + Math.random() * (HUMAN_LIKE_TYPING_DELAY_MAX_MS - HUMAN_LIKE_TYPING_DELAY_MIN_MS)
            console.log(`typing like a human in ${(typingDelay / 1000).toFixed(1)}s: "${aiResponseText}"`)
            await driver.sleep(typingDelay)

            const messageInputDiscord = await driver.wait(until.elementLocated(By.css('div[role="textbox"][aria-label*="Message"]')), 10000)
            await messageInputDiscord.sendKeys(aiResponseText, Key.ENTER)

            lastBotMessageContentSent = aiResponseText
            console.log("sent it")

          } catch (error) {
            console.error(`oops in loop: ${error.name} - ${error.message}`)
            if (error.name === 'NoSuchSessionError' || error.message.includes("target window is closed")) {
              console.error("browser dead exiting")
              clearInterval(messageCheckerInterval)
              if(driver) await driver.quit().catch(e => console.error("quit fail", e))
              driver = null
              process.exit(1)
            } else if (error.name === 'StaleElementReferenceError') {
              console.warn("element is stale discord changed stuff again")
            } else if (error.name === 'TimeoutError') {
              console.warn("timed out waiting for something chill")
            }
          }
        }

        messageCheckerInterval = setInterval(repeatSendMessage, CHECK_INTERVAL_MS)
        console.log(`watching messages every ${CHECK_INTERVAL_MS / 1000} sec`)

      } catch (error) {
        console.error("something exploded during setup:", error)
        if (driver) {
          await driver.quit().catch(e => console.error("couldnt quit", e))
        }
        process.exit(1)
      }
    }

    await seleniumTest()

  } catch (error) {
    console.log("bad stuff in WholeFunction:", error)
    process.exit(1)
  }

  const cleanup = async () => {
    console.log("\nshutting down chill")
    if (messageCheckerInterval) {
      clearInterval(messageCheckerInterval)
      console.log("stopped watching")
    }
    if (driver) {
      try {
        console.log("closing browser")
        await driver.quit()
        console.log("closed nice")
      } catch (e) {
        console.error("problem closing browser", e)
      }
    }
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('unhandledRejection', (reason, promise) => {
    console.error('unhandled stuff:', promise, 'reason:', reason)
  })
}

WholeFunction()
