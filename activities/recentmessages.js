'use strict';

const api = require('./common/api');

module.exports = async () => {
  try {
    const roomsResponse = await api('/rooms');
    if (Activity.isErrorResponse(roomsResponse)) return;

    const rooms = roomsResponse.body.items;

    const messages = {items: []};
    const mentions = {items: []};
    const files = {items: []};

    // groups api requests and sends them in parallel
    const promises = [];
    for (let i = 0; i < rooms.length; i++) {
      promises.push(api(`/messages?roomId=${rooms[i].id}&max=50`));
    }
    const results = await Promise.all(promises);

    //filters messages by date and time they were sent
    const filteredResults = [];
    for (let i = 0; i < results.length; i++) {
      if (Activity.isErrorResponse(results[i])) return;
      filteredResults.push(filterMessagesByTime(results[i].body.items));
      //filteredResults.push(results[i].body.items); // for testing, if recent items is empty or too small
    }

    //converts messages to items and filters out mentions and files
    for (let i = 0; i < filteredResults.length; i++) {
      for (let j = 0; j < filteredResults[i].length; j++) {
        const raw = filteredResults[i][j];
        const item = {id: raw.id, title: raw.roomType, description: raw.text, link: raw.url, raw: raw};
        messages.items.push(item);

        //checks for files
        if (raw.files) {
          for (let z = 0; z < raw.files.length; z++) {
            const file = raw.files[z];
            files.items.push(file);
          }
        }

        //checks for mentions
        if (raw.mentionedPeople) {
          for (let z = 0; z < raw.mentionedPeople.length; z++) {
            const mention = raw.mentionedPeople[z];
            mentions.items.push(mention);
          }
        }
      }
    }

    const response = {
      messages,
      files,
      mentions
    };

    Activity.Response.Data = response;
  } catch (error) {
    Activity.handleError(error);
  }
};
//** checks for messages that were written after 'timeToCheck' Date Time */
function filterMessagesByTime(messages) {
  const recentMessages = [];
  const timeToCheckAfter = new Date().valueOf() - 2 * 60 * 60 * 1000; // now - 2 hours

  for (let j = messages.length - 1; j >= 0; j--) {
    const createDate = new Date(messages[j].created).valueOf();
    if (createDate > timeToCheckAfter) {
      recentMessages.push(messages[j]);
    } else {
      // if we hit message older than 'timeToCheck' we break as all messages after that are older
      break;
    }
  }

  return recentMessages;
}
