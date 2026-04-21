/**
 * Models Index
 * Exports all Mongoose models
 */

const KeyModel = require('./Key');
const FarmModel = require('./Farm');
const BanModel = require('./Ban');
const LogModel = require('./Log');

module.exports = {
    KeyModel,
    FarmModel,
    BanModel,
    LogModel
};
