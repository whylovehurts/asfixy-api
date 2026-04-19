const mongoose = require('mongoose');

const KeySchema = new mongoose.Schema({
    ip: { type: String, default: "MANUAL" }, 
    key: { type: String, required: true, unique: true },
    isPermanent: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

KeySchema.index({ createdAt: 1 }, { 
    expireAfterSeconds: 43200, 
    partialFilterExpression: { isPermanent: false } 
});

module.exports = mongoose.model('Key', KeySchema);