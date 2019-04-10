'use strict';

const api = require('./common/api');

module.exports = async () => {
  try {
    const response = await api('/rooms');

    Activity.Response.Data = {
      success: response && response.statusCode === 200
    };
  } catch (error) {
    Activity.handleError(error);
    Activity.Response.Data.success = false;
  }
};
