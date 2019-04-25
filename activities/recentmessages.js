'use strict';

const api = require('./common/api');

const dateDescending = (a, b) => {
  if (a.lastActivity && b.lastActivity) {
    a = new Date(a.lastActivity);
    b = new Date(b.lastActivity);
  } else {
    a = new Date(a.date);
    b = new Date(b.date);
  }

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
    }

    const me = await api('/people/me');

    //converts messages to items and filters out mentions and files
    const userPromises = new Map();

    const data = {
      messages: {
        items: []
      },
      mentions: {
        items: []
      },
      files: {items: []} // for preserved card logic
    };

    for (let i = 0; i < filteredMessages.length; i++) {
      for (let j = 0; j < filteredMessages[i].length; j++) {
        const raw = filteredMessages[i][j];
        const item = {
          id: raw.id,
          title: raw.roomType,
          description: raw.text,
          link: raw.url,
          date: new Date(raw.created),
          raw: raw
        };

        // get room name for the message
        for (let k = 0; k < rooms.body.items.length; k++) {
          if (raw.roomId === rooms.body.items[k].id) item.room = rooms.body.items[k].title;
        }

        // push constructed item
        data.messages.items.push(item);

        // if we haven't encountered this user yet, store promise to retrieve user data in map
        if (!userPromises.has(raw.personId)) userPromises.set(raw.personId, api(`/people/${raw.personId}`, {
          throwHttpErrors: false
        }));

        //checks for mentions
        if (raw.mentionedPeople) {
          for (let k = 0; k < raw.mentionedPeople.length; k++) {
            if (raw.mentionedPeople[k] === me.body.id) data.mentions.items.push(item);
          }
        }
      }
    }

    const users = await Promise.all(userPromises.values());

    // Loop through user info for all users
    for (let i = 0; i < users.length; i++) {
      if ($.isErrorResponse(activity, users[i])) continue;

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
    }

    data.messages.items.sort(dateDescending);
    data.mentions.items.sort(dateDescending);

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
    activity.Response.ErrorCode = 0;
  } catch (error) {
    $.handleError(activity, error);
  }
};

// checks for messages that were written after 'timeToCheck' Date Time
function filterMessagesByTime(messages) {
  const recents = [];
  const now = new Date();
  const timeToCheckAfter = new Date(now.setHours(now.getHours() - 12));

  for (let j = 0; j < messages.length; j++) {
    const createDate = new Date(messages[j].created);

    if (createDate > timeToCheckAfter) {
      recents.push(messages[j]);
    } else {
      break;
    }
  }

  return recents;
}
