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

    // groups api requests and sends them in parallel
    let promises = [];
    for (let i = 0; i < rooms.length; i++) {
      promises.push(api(`/messages?roomId=${rooms[i].id}&max=50`));
    }
    let results = await Promise.all(promises);

    //filters messages by date and time they were sent
    let filteredResults = [];
    for (let i = 0; i < results.length; i++) {
      if (Activity.isErrorResponse(results[i])) return;
      filteredResults.push(filterMessagesByTime(results[i].body.items));
    }

    //converts messages to items and filters out mentions and files
    for (let i = 0; i < filteredResults.length; i++) {
      for (let j = 0; j < filteredResults[i].length; j++) {
        let raw = filteredResults[i][j];
        let item = { id: raw.id, title: raw.roomType, description: raw.text, link: raw.url, raw: raw };
        messages.push(item);

        //checks for files
        if (raw.files) {
          for (let z = 0; z < raw.files.length; z++) {
            let file = raw.files[z];
            files.push(file);
          }
        }

        //checks for mentions
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
//** checks for messages that were written after 'timeToCheck' Date Time */
function filterMessagesByTime(messages) {
  let recentMessages = [];
  let timeToCheckAfter = new Date().valueOf() - 2 * 60 * 60 * 1000; // now - 2 hours

  for (let j = messages.length - 1; j >= 0; j--) {
    let createDate = new Date(messages[j].created).valueOf();
    if (createDate > timeToCheckAfter) {
      recentMessages.push(messages[j]);
    } else {
      // if we hit message older than 'timeToCheck' we break as all messages after that are older
      break;
    }
  }

  return recentMessages;
}