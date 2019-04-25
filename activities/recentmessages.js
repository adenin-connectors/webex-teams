'use strict';

const api = require('./common/api');

const dateDescending = (a, b) => {
  if (a.lastActivity && b.lastActivity) {
    a = new Date(a.lastActivity);
    b = new Date(b.lastActivity);

    return a > b ? -1 : (a < b ? 1 : 0);
  }

  a = new Date(a.date);
  b = new Date(b.date);

  return a > b ? -1 : (a < b ? 1 : 0);
};

module.exports = async (activity) => {
  try {
    api.initialize(activity);

    const rooms = await api('/rooms');

    if ($.isErrorResponse(activity, rooms)) return;

    // groups api requests and sends them in parallel
    const messagePromises = [];

    for (let i = 0; i < rooms.body.items.length; i++) {
      messagePromises.push(api(`/messages?roomId=${rooms.body.items[i].id}`));
    }

    const messages = await Promise.all(messagePromises);

    //filters messages by date and time they were sent
    const filteredMessages = [];

    for (let i = 0; i < messages.length; i++) {
      if ($.isErrorResponse(activity, messages[i])) return;

      filteredMessages.push(filterMessagesByTime(messages[i].body.items));
      filteredMessages.push(messages[i].body.items); // for testing, if recent items is empty or too small
    }

    const me = await api('/people/me');

    //converts messages to items and filters out mentions and files
    const userPromises = new Map();
    //const rawFiles = []; // disable files for now

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

    for (let i = 0; i < filteredMessages.length; i++) {
      for (let j = 0; j < filteredMessages[i].length; j++) {
        const raw = filteredMessages[i][j];
        const item = {
          id: raw.id,
          title: raw.roomType,
          description: raw.text,
          link: raw.url,
          date: (new Date(raw.created)).toISOString(),
          raw: raw
        };

        // get room name for the message
        for (let k = 0; k < rooms.body.items.length; k++) {
          if (raw.roomId === rooms.body.items[k].id && raw.roomType !== 'direct') item.room = rooms.body.items[k].title;
        }

        // push constructed item
        data.messages.items.push(item);

        // if we haven't encountered this user yet, store promise to retrieve user data in map
        if (!userPromises.has(raw.personId)) userPromises.set(raw.personId, api(`/people/${raw.personId}`));

        //checks for files, store promise to get info as well as author and date
        /*if (raw.files) {
          for (let k = 0; k < raw.files.length; k++) {
            rawFiles.push({
              promise: api.head(raw.files[k]),
              personId: raw.personId,
              created: raw.created,
              raw: raw.files[k]
            });
          }
        }*/

        //checks for mentions
        if (raw.mentionedPeople) {
          for (let k = 0; k < raw.mentionedPeople.length; k++) {
            if (raw.mentionedPeople[k] === me.body.id) data.mentions.items.push(item);
          }
        }
      }
    }

    await Promise.all(userPromises.values())
      .catch((err) => {
        logger.error('A user\'s info failed to resolve', err);
        return userPromises.values();
      })
      .then((users) => {
        // Loop through user info for all users
        for (let i = 0; i < users.length; i++) {
          if ($.isErrorResponse(activity, users[i])) return;

          // map extended user info onto matching messages
          for (let j = 0; j < data.messages.items.length; j++) {
            if (data.messages.items[j].raw.personId === users[i].body.id) {
              data.messages.items[j].displayName = users[i].body.displayName;
              data.messages.items[j].avatar = users[i].body.avatar;
            }
          }

          // map extended user info onto matching mentions
          for (let j = 0; j < data.mentions.items.length; j++) {
            if (data.messages.items[j].raw.personId === users[i].body.id) {
              data.mentions.items[j].displayName = users[i].body.displayName;
              data.mentions.items[j].avatar = users[i].body.avatar;
            }
          }

          // get correct user name to display with file info
          /*for (let j = 0; j < rawFiles.length; j++) {
            if (rawFiles[j].personId === users[i].body.id) rawFiles[j].displayName = users[i].body.displayName;
          }*/
        }
      });

    // await file promises to get type and filename
    /*const files = await Promise.all(rawFiles.map(async (file) => file.promise));

    for (let i = 0; i < files.length; i++) {
      if ($.isErrorResponse(activity, files[i])) return;

      const disposition = files[i].headers['content-disposition'];

      data.files.items.push({
        type: files[i].headers['content-type'],
        name: disposition.substring(disposition.indexOf('"') + 1, disposition.lastIndexOf('"')),
        author: rawFiles[i].displayName,
        created: rawFiles[i].created
      });
    }*/

    data.messages.items.sort(dateDescending);
    data.mentions.items.sort(dateDescending);
    data.files.items.sort(dateDescending);

    // group messages by last active room
    const groupedMessages = [];

    rooms.body.items.sort(dateDescending);

    for (let i = 0; i < rooms.body.items.length; i++) {
      for (let j = 0; j < data.messages.items.length; j++) {
        if (data.messages.items[j].raw.roomId === rooms.body.items[i].id) groupedMessages.push(data.messages.items[j]);
      }
    }

    data.messages.items = groupedMessages;

    activity.Response.Data = data;
  } catch (error) {
    $.handleError(activity, error);
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
