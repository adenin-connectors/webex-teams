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

    let promises = [];
    let results = [];

    for (let i = 0; i < rooms.length; i++) {
      promises.push(api(`/messages?roomId=${rooms[i].id}`));
    }

    results = await Promise.all(promises);

    for (let i = 0; i < results.length; i++) {
      if (Activity.isErrorResponse(results[i])) return;

      for (let j = 0; j < results[i].body.items.length; j++) {
        let raw = results[i].body.items[j];
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