import telegramBot from 'node-telegram-bot-api'
import dotenv from 'dotenv'
import { transliterate } from 'transliteration'
// const tesseract = await import('tesseract.js');
// const vision = await import('@google-cloud/vision');

dotenv.config()

import express from 'express';

const app = express()

app.listen(8080, () => {
    console.log(`Server running on port 8080`);
  })

const bot = new telegramBot(process.env.BOT_TOKEN, { polling: true })

bot.on('message', (msg) => {
    console.log('msg: ', JSON.stringify(msg))

    if(sentByTolya(msg)) {
        console.log('sent by Tolya')
        createVenmoPaymentLink(msg)
    }

    // if(msg.text === '/recognize') {
    //     recognizeReceipt(msg)
    // }
})

bot.on('polling_error', (error) => {
    console.log('polling_error')
    console.error(error)
  })

const sentByTolya = (msg) => msg.forward_from?.id === +process.env.TOLYA_TELEFARAM_ID

const createVenmoPaymentLink = (msg) => {
    const chatId = msg.chat.id;
    const numbers = msg.text.match(/(\d+\.\d+|\d+)/g);
    const sender = transliterate(msg.from.first_name ?? msg.from.username)
    console.log(`First name: ${msg.from.first_name}, Last name: ${msg.from.last_name}, Username: ${msg.from.username}`)
    bot.sendMessage(chatId, `https://venmo.com/${process.env.TOLYA_VENMO_USER_NAME}?txn=pay&amount=${numbers[0]}&note=Volleyball%20${sender}`)
}

// const recognizeReceipt = async (msg) => {
//     const chatId = msg.chat.id;
//     const client = new vision.ImageAnnotatorClient()

//     const output = await client.textDetection('./receipt.jpeg')
//     console.log(output[0].fullTextAnnotation.pages[0].blocks[0].paragraphs[0].boundingBox)
//     // console.log(output[0].fullTextAnnotation.text)
//     // output.forEach(label => label.labelAnnotations.forEach(text => console.log(text.description)))
//     // output.forEach(label => console.log(label))
//     // console.log('output: ', output)
//     // const output = await tesseract.default.recognize('./receipt.jpeg', 'eng', {logger: (e) => console.log(e)})
//     // console.log(output.data.text)
//     // bot.sendMessage(chatId, 'Done');
// }