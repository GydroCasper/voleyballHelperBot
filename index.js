import telegramBot from "node-telegram-bot-api"
import dotenv from "dotenv"
import { transliterate } from "transliteration"
import fetch from 'node-fetch'
import FormData from 'form-data'
import fs from "fs"
import util from "util"

const vision = await import("@google-cloud/vision")

dotenv.config()


const logFile = fs.createWriteStream("log.txt", { flags: "a" })
const logStdout = process.stdout

console.log = function () {
  logFile.write(util.format.apply(null, arguments) + "\n")
  logStdout.write(util.format.apply(null, arguments) + "\n")
}

const bot = new telegramBot(process.env.BOT_TOKEN, { polling: true })

bot.on("message", (msg) => {
  console.log("msg: ", JSON.stringify(msg))

  if (sentByTolya(msg)) {
    console.log("sent by Tolya")
    createVenmoPaymentLink(msg)
    return
  }

  if (msg.photo) {
    recognizeReceipt(msg)
  }
})

bot.on("polling_error", (error) => {
  console.log("polling_error")
  console.error(error)
})

const sentByTolya = (msg) =>
  msg.forward_from?.id === +process.env.TOLYA_TELEFARAM_ID

const createVenmoPaymentLink = (msg) => {
  const chatId = msg.chat.id
  const numbers = msg.text.match(/(\d+\.\d+|\d+)/g)
  const sender = transliterate(msg.from.first_name ?? msg.from.username)
  console.log(
    `First name: ${msg.from.first_name}, Last name: ${msg.from.last_name}, Username: ${msg.from.username}`
  )
  bot.sendMessage(
    chatId,
    `https://venmo.com/${process.env.TOLYA_VENMO_USER_NAME}?txn=pay&amount=${numbers[0]}&note=Volleyball%20${sender}`
  )
}

const recognizeReceipt = async (msg) => {
  const chatId = msg.chat.id
  const fileId = msg.photo[msg.photo.length-1].file_id
  const file = await bot.getFile(fileId)
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`
  const res = await fetch(url)
  const buffer = await res.arrayBuffer()
  const uint8array = new Uint8Array(buffer)

  const request = {
      image: {
          content: uint8array,
      },
  }

  const client = new vision.ImageAnnotatorClient()

  const output = await client.textDetection(request)
  const rows = output[0].textAnnotations[0].description.split("\n")

  let plates = collectPlatesFullNames(rows)
  const enrichedPlates = enrichPlatesWithBlocks(
    plates,
    output[0].textAnnotations
  )
  const { pricesIndex, pricesBlockIndex } = enrichedPlates
  plates = enrichedPlates.plates
  const tg = calculateTg(plates)

  enrichPlatesWithPrices(
    plates,
    output[0].textAnnotations,
    pricesBlockIndex,
    rows,
    pricesIndex,
    tg
  )

  calculatePriceForEach(plates)

  const platesToPrint = printPlates(plates)
  bot.sendMessage(chatId, platesToPrint)
}

const isPrice = (str) => str.startsWith("$")

const printPlates = (plates) => {
  let response = ''
  for (let ind = 0; ind < plates.length; ind++) {
    const plate = plates[ind]
    response += (`${plate.fullName}\t${plate.price != null ? ': $' : ''}${plate.price ?? ''}\n`)
    // console.log("fullName: ", plate.fullName)
    // for (let blockInd = 0; blockInd < plate.blocks.length; blockInd++) {
    //   const block = plate.blocks[blockInd]
    //   console.log("blockDescription: ", block.description)
    // }
    // console.log("price: ", plate.price)
  }

  return response
}

const collectPlatesFullNames = (rows) => {
  let i = 0
  const plates = []
  while (!isPrice(rows[i])) {
    const row = rows[i++]
    plates.push({
      fullName: row.trim(),
      blocks: [],
    })
  }

  return plates
}

const enrichPlatesWithBlocks = (plates, textAnnotations) => {
  let i = 1
  let plateIndex = 0
  let plateNameLeft = plates[plateIndex].fullName.trim()
  let blockDescription = ""
  while (!isPrice(blockDescription)) {
    const block = textAnnotations[i++]
    blockDescription = block.description

    if (plateNameLeft.startsWith(blockDescription)) {
      plates[plateIndex].blocks.push(block)
      plateNameLeft = plateNameLeft.slice(blockDescription.length).trim()
    } else {
      plateIndex = plateIndex + 1
      if (plateIndex >= plates.length) {
        break
      }
      plateNameLeft = plates[plateIndex].fullName.trim()
      if (plateNameLeft.startsWith(blockDescription)) {
        plates[plateIndex].blocks.push(block)
        plateNameLeft = plateNameLeft.slice(blockDescription.length).trim()
      } else {
        throw Error("Can't find the plate for the block")
      }
    }
  }

  return { pricesIndex: plateIndex, plates, pricesBlockIndex: i }
}

const calculateTg = (plates) => {
  const maxBlocksNumber = plates[0].blocks
  const maxBlocksIndex = 0

  for (let i = 0; i < plates.length; i++) {
    if (plates[i].blocks.length > maxBlocksNumber) {
      maxBlocksIndex = i
      maxBlocksNumber = plates[i].blocks.length
    }
  }

  const plateWithMaxBlocksNumber = plates[maxBlocksIndex]

  const leftBottomCorner =
    plateWithMaxBlocksNumber.blocks[0].boundingPoly.vertices[3]
  const rightBottomCorner =
    plateWithMaxBlocksNumber.blocks[plateWithMaxBlocksNumber.blocks.length - 1]
      .boundingPoly.vertices[2]

  return rightBottomCorner.x != leftBottomCorner.x
    ? (rightBottomCorner.y - leftBottomCorner.y) /
        (rightBottomCorner.x - leftBottomCorner.x)
    : 0
}

const enrichPlatesWithPrices = (
  plates,
  textAnnotations,
  pricesBlockIndex,
  rows,
  pricesIndex,
  tg
) => {
  for (let i = pricesIndex; i < rows.length; i++) {
    let block = textAnnotations[pricesBlockIndex]
    if (block.description == "$") {
      pricesBlockIndex++
    }

    block = textAnnotations[pricesBlockIndex++]
    const rightBottomCorner = block.boundingPoly.vertices[2]

    let closestPlate = {}

    for (let plateIndex = 0; plateIndex < plates.length; plateIndex++) {
      const plate = plates[plateIndex]
      const leftBottomCorner = plate.blocks[0].boundingPoly.vertices[3]
      const height = (rightBottomCorner.x - leftBottomCorner.x) * tg
      const calculatedY = leftBottomCorner.y + height
      const calculatedHeight = Math.abs(rightBottomCorner.y - calculatedY)

      if (
        closestPlate.distance == undefined ||
        closestPlate.distance > calculatedHeight
      ) {
        closestPlate = { distance: calculatedHeight, plateIndex: plateIndex }
      }
    }

    plates[closestPlate.plateIndex].price = +block.description
  }
}

const calculatePriceForEach = (plates) => {
  for (let i = 0; i < plates.length; i++) {
    const plate = plates[i]
    if (isNaN(plate.price)) {
      plate.price = null
      continue
    }
    let amount = 1
    const originalPrice = plate.price
    if (isFirstWordAmount(plate.fullName)) {
      amount = plate.fullName.trim().split(" ")[0]
      plate.fullName = plate.fullName.slice(amount.length).trim()
    }

    plate.price = plate.price * 1.284
    if (+amount > 1) {
      plate.price = plate.price / +amount
      plate.fullName += " - each"
    }

    plate.fullName += ` (${originalPrice} for ${amount})`

    plate.price = Math.ceil(plate.price * 100) / 100
  }
}

const isFirstWordAmount = (row) => {
  let words = row.trim().split(" ")
  return !isNaN(words[0].trim()) && words[1].trim() != "oz"
}
