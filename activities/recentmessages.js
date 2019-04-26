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

    // convert messages to items and filter out mentions
    const userPromises = new Map(); // map promise to ID so we don't duplicate

    const data = {
      messages: {
        count: 0,
        items: []
      },
      mentions: {
        count: 0,
        items: []
      },
      files: {items: []} // for preserved card logic
    };

    // for each room
    for (let i = 0; i < filteredMessages.length; i++) {
      // count messages
      data.messages.count += filteredMessages[i].length;

      // for first 3 messages in current room
      for (let j = 0; j < 3 && j < filteredMessages[i].length; j++) {
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
            if (raw.roomId === rooms[k].id) {
              item.roomName = rooms[k].title;
              break; // skip remaining once found
            }
          }

          break;
        // 3rd message is last message displayed
        case 2 || filteredMessages[i].length - 1:
          item.gtype = 'last';
          item.hiddenCount = filteredMessages[i].length - 3;
        }

        // store a promise to retrieve user data, if one doesn't yet exist
        if (!userPromises.has(raw.personId)) userPromises.set(raw.personId, api(`/people/${raw.personId}`, {
          throwHttpErrors: false
        }));

        // push constructed item
        data.messages.items.push(item);
      }

      // keep track of mentions from current room so we can stop after 3
      let currentRoomMentions = 0;

      // don't call api for user info until we know we definitely need it
      let me = null;

      // need to check every message in current room for mentions
      for (let j = 0; j < filteredMessages[i].length; j++) {
        // if we already have 3 we can stop
        if (currentRoomMentions === 3) break;

        const raw = filteredMessages[i][j];

        // skip if no mentions
        if (!raw.mentionedPeople) continue;

        // need current user's id to know when they've been mentioned
        if (!me) me = await api('/people/me');

        // check each mention
        for (let k = 0; k < raw.mentionedPeople.length; k++) {
          // skip mention if not me
          if (raw.mentionedPeople[k] !== me.body.id) continue;

          // we've found a mention, construct it
          currentRoomMentions++;

          const item = {
            id: raw.id,
            title: raw.roomType,
            description: raw.text,
            link: raw.url,
            date: new Date(raw.created),
            personId: raw.personId
          };

          // indicate if its the first or last mention to be displayed
          switch (currentRoomMentions) {
          // first
          case 1:
            item.gtype = 'first';

            // get room name for the message
            for (let l = 0; l < rooms.length; l++) {
              if (raw.roomId === rooms[l].id) {
                item.roomName = rooms[l].title;
                break; // skip remaining once found
              }
            }

            break;
          // 3rd message is last message displayed
          case 3: item.gtype = 'last';
          }

          // store a promise to retrieve user data, if one doesn't yet exist
          if (!userPromises.has(raw.personId)) userPromises.set(raw.personId, api(`/people/${raw.personId}`, {
            throwHttpErrors: false
          }));

          data.mentions.items.push(item);
          data.mentions.count++;
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
          data.messages.items[j].personId = undefined; // remove irrelevant property
          data.messages.items[j].displayName = users[i].body.displayName;
          data.messages.items[j].avatar = users[i].body.avatar;
        }

        // assign avatar for the contact if direct message (avatar should match contact, not most recent user)
        if (
          data.messages.items[j].gtype === 'first' &&
          data.messages.items[j].title === 'direct' &&
          data.messages.items[j].roomName === users[i].body.displayName
        ) {
          data.messages.items[j].roomAvatar = users[i].body.avatar;
        }
      }

      // map extended user info onto matching mentions
      for (let j = 0; j < data.mentions.items.length; j++) {
        if (data.mentions.items[j].personId === users[i].body.id) {
          data.mentions.items[j].personId = undefined; // remove irrelevant property
          data.mentions.items[j].displayName = users[i].body.displayName;
          data.mentions.items[j].avatar = users[i].body.avatar;
        }

        // assign avatar for the contact if direct message (avatar should match contact, not most recent user)
        if (
          data.mentions.items[j].gtype === 'first' &&
          data.mentions.items[j].title === 'direct' &&
          data.mentions.items[j].roomName === users[i].body.displayName
        ) {
          data.mentions.items[j].roomAvatar = users[i].body.avatar;
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

  return then > limit; // if date is after the limit
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
