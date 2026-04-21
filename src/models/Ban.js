/**
 * Ban Model
 * Represents banned IPs and keys
 */

const mongoose = require('mongoose');

const BanSchema = new mongoose.Schema({
    ip: String,
    key: String,
    reason: { 
        type: String, 
        default: "manual" 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

// Index for fast lookups
BanSchema.index({ ip: 1 });
BanSchema.index({ key: 1 });

const BanModel = mongoose.model('Ban', BanSchema);

module.exports = BanModel;
