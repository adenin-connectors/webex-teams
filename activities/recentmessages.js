'use strict';
const api = require('./common/api');

module.exports = async function (activity) {
  try {
    const roomsResponse = await api(`/rooms`);

    if (Activity.isErrorResponse(roomsResponse)) return;

    let rooms = roomsResponse.body.items;

    let messages = [];
    let mentions = [];
    let files = [];
    for (let i = 0; i < rooms.length; i++) {
      const messagesResponse = await api(`/messages?roomId=${rooms[i].id}`);
      if (Activity.isErrorResponse(messagesResponse)) return;
      for (let j = 0; j < messagesResponse.body.items.length; j++) {
        let raw = messagesResponse.body.items[j];
        let item = { id: raw.id, title: raw.roomType, description: raw.text, link: raw.url, raw: raw };
        messages.push(item);
        if (raw.files) {
          for (let z = 0; z < raw.files.length; z++) {
            let file = raw.files[z];
            files.push(file);
          }
        }
        if (raw.mentionedPeople) {
          for (let z = 0; z < raw.mentionedPeople.length; z++) {
            let mention = raw.mentionedPeople[z];
            mentions.push(mention);
          }
        }
      }
    }

    let response = {
      messages,
      files,
      mentions
    };

    activity.Response.Data = response;
  } catch (error) {
    Activity.handleError(error);
  }
};