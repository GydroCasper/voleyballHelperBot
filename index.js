import telegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { transliterate } from 'transliteration';
dotenv.config();

const bot = new telegramBot(process.env.BOT_TOKEN, { polling: true });

bot.on('message', (msg) => {
    if(sentByTolya(msg)) {
        createVenmoPaymentLink(msg)
    }
});

const sentByTolya = (msg) => msg.forward_from?.id === +process.env.TOLYA_TELEFARAM_ID;

const createVenmoPaymentLink = (msg) => {
    const chatId = msg.chat.id;
    const numbers = msg.text.match(/(\d+\.\d+|\d+)/g);
    const sender = transliterate(msg.from.first_name ?? msg.from.username)
    bot.sendMessage(chatId, `https://venmo.com/${process.env.TOLYA_VENMO_USER_NAME}?txn=pay&amount=${numbers[0]}&note=Volleyball%20${sender}`);
}