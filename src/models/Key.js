/**
 * Key Model
 * Represents API access keys with IP binding and expiration
 */

const mongoose = require('mongoose');

const KeySchema = new mongoose.Schema({
    ip: { 
        type: String, 
        default: "MANUAL" 
    },
    key: { 
        type: String, 
        required: true, 
        unique: true,
        lowercase: true
    },
    isPermanent: { 
        type: Boolean, 
        default: false 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

// TTL index: expire temporary keys after 12 hours
KeySchema.index(
    { createdAt: 1 }, 
    { 
        expireAfterSeconds: 43200, 
        partialFilterExpression: { isPermanent: false } 
    }
);

// Index for ownerKey lookups
KeySchema.index({ key: 1 });

const KeyModel = mongoose.model('Key', KeySchema);

module.exports = KeyModel;
