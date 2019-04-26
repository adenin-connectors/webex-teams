'use strict';

const api = require('./common/api');

const dateDescending = (a, b) => {
  a = new Date(a.lastActivity);
  b = new Date(b.lastActivity);

  return a > b ? -1 : (a < b ? 1 : 0);
};

module.exports = async (activity) => {
  try {
    api.initialize(activity);

    // fetch rooms
    const roomsResponse = await api('/rooms');

    // if bad response, process and return
    if ($.isErrorResponse(activity, roomsResponse)) return;

    // get room items from response
    const rooms = roomsResponse.body.items;

    // sort them newest first (aren't always chronological)
    rooms.sort(dateDescending);

    // group api requests for messages to send in parallel
    const messagePromises = [];

    for (let i = 0; i < rooms.length; i++) {
      // stop when room wasn't active recently enough
      if (!isRecent(rooms[i].lastActivity)) break;

      // push the promise to get the room's messages
      messagePromises.push(api(`/messages?roomId=${rooms[i].id}`));
    }

    // await promises in parallel, returns an array of msgs for each room
    const messagesResponses = await Promise.all(messagePromises);

    // filter messages by date and time they were sent
    const filteredMessages = [];

    // loop over array for each room
    for (let i = 0; i < messagesResponses.length; i++) {
      if ($.isErrorResponse(activity, messagesResponses[i])) return;

      // only push most recent messages from the room
      filteredMessages.push(filterMessagesByTime(messagesResponses[i].body.items));
    }

    // need current user's id to know when they've been mentioned
    const me = await api('/people/me');

    // convert messages to items and filter out mentions and files
    const userPromises = new Map(); // map promise to ID so we don't duplicate

    const data = {
      messages: {
        items: []
      },
      mentions: {
        items: []
      },
      files: {items: []} // for preserved card logic
    };

    // for each room
    for (let i = 0; i < filteredMessages.length; i++) {
      // for each message in current room
      for (let j = 0; j < filteredMessages[i].length; j++) {
        const raw = filteredMessages[i][j];
        const item = {
          id: raw.id,
          title: raw.roomType,
          description: raw.text,
          link: raw.url,
          date: new Date(raw.created),
          personId: raw.personId
        };

        // indicate if its the first or last message in the thread
        switch (j) {
        // first
        case 0:
          item.gtype = 'first';

          // get room name for the message
          for (let k = 0; k < rooms.length; k++) {
            if (raw.roomId === rooms[k].id) item.roomName = rooms[k].title;
            break; // skip remaining once found
          }

          break;
        // last
        case (filteredMessages[i].length - 1): item.gtype = 'last';
        }

        // store a promise to retrieve user data, if one doesn't yet exist
        if (!userPromises.has(raw.personId)) userPromises.set(raw.personId, api(`/people/${raw.personId}`, {
          throwHttpErrors: false
        }));

        // push constructed item
        data.messages.items.push(item);

        // if there's mentions, and one is of current user, also push message to mentions array
        if (raw.mentionedPeople) {
          for (let k = 0; k < raw.mentionedPeople.length; k++) {
            if (raw.mentionedPeople[k] === me.body.id) {
              data.mentions.items.push(item);
              break; // can ignore remaining mentions once found
            }
          }
        }
      }
    }

    // we need to extend the user information for each message, resolve the stored promises
    const users = await Promise.all(userPromises.values());

    // Loop through user info for all users
    for (let i = 0; i < users.length; i++) {
      // skip if the user wasn't found
      if ($.isErrorResponse(activity, users[i])) continue;

      // map extended user info onto matching messages
      for (let j = 0; j < data.messages.items.length; j++) {
        if (data.messages.items[j].personId === users[i].body.id) {
          data.messages.items[j].displayName = users[i].body.displayName;
          data.messages.items[j].avatar = users[i].body.avatar;
        }
      }

      // map extended user info onto matching mentions
      for (let j = 0; j < data.mentions.items.length; j++) {
        if (data.messages.items[j].personId === users[i].body.id) {
          data.mentions.items[j].displayName = users[i].body.displayName;
          data.mentions.items[j].avatar = users[i].body.avatar;
        }
      }
    }

    activity.Response.Data = data;
    activity.Response.ErrorCode = 0; // if a user 404'd, error code was set - reset it
  } catch (error) {
    $.handleError(activity, error);
  }
};

function isRecent(date) {
  const then = new Date(date);
  const now = new Date();
  const limit = new Date(now.setHours(now.getHours() - 12));

  const isRecent = then > limit;

  return isRecent; // if date is after the limit
}

// checks for messages that were written after 'timeToCheck' Date Time
function filterMessagesByTime(messages) {
  const recents = [];

  for (let j = 0; j < messages.length; j++) {
    if (isRecent(messages[j].created)) {
      recents.push(messages[j]);
    } else {
      break;
    }
  }

  return recents;
}
