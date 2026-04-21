/**
 * Farm Model
 * Represents Cookie Clicker game save data
 */

const mongoose = require('mongoose');

const FarmSchema = new mongoose.Schema({
    ownerKey: { 
        type: String, 
        required: true 
    },
    bakeryName: { 
        type: String, 
        required: true 
    },
    cookies: Number,
    prestige: Number,
    cookiesPs: Number,
    version: String,
    gameVersion: String,
    saveKey: String,
    lastUpdate: { 
        type: Date, 
        default: Date.now 
    }
});

// Index for ownerKey lookups
FarmSchema.index({ ownerKey: 1 });

const FarmModel = mongoose.model('Farm', FarmSchema);

module.exports = FarmModel;
