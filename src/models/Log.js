/**
 * Log Model
 * Audit log for API requests
 */

const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
    ip: String,
    key: String,
    route: String,
    method: String,
    status: Number,
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

// Index for log queries
LogSchema.index({ createdAt: -1 });
LogSchema.index({ key: 1 });

const LogModel = mongoose.model('Log', LogSchema);

module.exports = LogModel;
