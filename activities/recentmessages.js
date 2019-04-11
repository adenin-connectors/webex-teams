'use strict';

const api = require('./common/api');

module.exports = async () => {
  try {
    const roomsResponse = await api('/rooms');

    if (Activity.isErrorResponse(roomsResponse)) return;

    // groups api requests and sends them in parallel
    const messages = [];

    for (let i = 0; i < roomsResponse.body.items.length; i++) {
      messages.push(api(`/messages?roomId=${roomsResponse.body.items[i].id}`));
    }

    const messageResults = await Promise.all(messages);

    //filters messages by date and time they were sent
    const filteredMessageResults = [];

    for (let i = 0; i < messageResults.length; i++) {
      if (Activity.isErrorResponse(messageResults[i])) return;

      filteredMessageResults.push(filterMessagesByTime(messageResults[i].body.items));
      filteredMessageResults.push(messageResults[i].body.items); // for testing, if recent items is empty or too small
    }

    //converts messages to items and filters out mentions and files
    const users = new Map();
    const files = [];

    const data = {
      messages: {
        items: []
      },
      mentions: {
        items: []
      },
      files: {
        items: []
      }
    };

    for (let i = 0; i < filteredMessageResults.length; i++) {
      for (let j = 0; j < filteredMessageResults[i].length; j++) {
        const raw = filteredMessageResults[i][j];

        const item = {
          id: raw.id,
          title: raw.roomType,
          description: raw.text,
          link: raw.url,
          raw: raw
        };

        // if we haven't encountered this user yet, store promise to retrieve user data in map
        if (!users.has(raw.personId)) users.set(raw.personId, api(`/people/${raw.personId}`));

        data.messages.items.push(item);

        //checks for files
        if (raw.files) {
          for (let z = 0; z < raw.files.length; z++) {
            files.push(api.head(raw.files[z]));
          }
        }

        //checks for mentions
        if (raw.mentionedPeople) {
          for (let z = 0; z < raw.mentionedPeople.length; z++) {
            data.mentions.items.push(raw.mentionedPeople[z]);
          }
        }
      }
    }

    const userResults = await Promise.all(users.values());

    // Loop through user info for all users
    for (let i = 0; i < userResults.length; i++) {
      if (Activity.isErrorResponse(userResults[i])) return;

      // map extended user info onto matching messages
      for (let j = 0; j < data.messages.items.length; j++) {
        if (data.messages.items[j].raw.personId === userResults[i].body.id) {
          data.messages.items[j].displayName = userResults[i].body.displayName;
          data.messages.items[j].avatar = userResults[i].body.avatar;
        }
      }

      // map extended user info onto matching mentions
      for (let j = 0; j < data.mentions.items.length; j++) {
        if (data.messages.items[j].raw.personId === userResults[i].body.id) {
          data.mentions.items[j].displayName = userResults[i].body.displayName;
          data.mentions.items[j].avatar = userResults[i].body.avatar;
        }
      }
    }

    const fileResults = await Promise.all(files);

    for (let i = 0; i < fileResults.length; i++) {
      if (Activity.isErrorResponse(fileResults[i])) return;

      const disposition = fileResults[i].headers['content-disposition'];

      data.files.items.push({
        filetype: fileResults[i].headers['content-type'],
        filename: disposition.substring(disposition.indexOf('"') + 1, disposition.lastIndexOf('"'))
      });
    }

    Activity.Response.Data = data;
  } catch (error) {
    Activity.handleError(error);
  }
};

// checks for messages that were written after 'timeToCheck' Date Time
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
