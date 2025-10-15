const Notification = require('../../models/notification/notification');
const ActivityLog = require('../../models/notification/activityLog');
const ErrorLog = require('../../models/notification/errorLog');
const User = require('../../models/auth/auth');
const emailSender = require('../../utils/emailSender');

// Create a new notification
exports.createNotification = async (req, res) => {
  try {
    const { recipient, recipientModel, type, title, message, data } = req.body;
    
    const notification = new Notification({
      recipient,
      recipientModel,
      type,
      title,
      message,
      data
    });
    
    await notification.save();
    
    // Here you would trigger real-time notification via Socket.io
    // io.to(recipient).emit('notification', notification);
    
    // If notification is created by admin, send email only to subscribed customers
    if (req.user && req.user.role === 'admin') {
      // Import Newsletter model
      const Newsletter = require('../../models/newsletter/newsletter');
      
      // Fetch all active customers
      const customers = await User.find({ role: 'customer', status: 'active' }, 'email firstName lastName');
      
      // Send email only to subscribed customers
      for (const customer of customers) {
        try {
          // Check if customer is subscribed to newsletter
          const subscription = await Newsletter.findOne({ email: customer.email, isSubscribed: true });
          
          // Only send if subscribed
          if (subscription) {
            await emailSender.sendNotificationEmail(
              customer.email,
              title,
              message,
              `${customer.firstName} ${customer.lastName}`
            );
          }
        } catch (emailError) {
          console.error(`Failed to send email to ${customer.email}:`, emailError);
          // Continue with other emails even if one fails
        }
      }
    }
    
    res.status(201).json({ success: true, data: notification });
  } catch (error) {
    await logError(error, req, 'error');
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get notifications for a user
exports.getUserNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 10, isRead } = req.query;
    const userId = req.user._id;
    const userModel = req.user.role === 'admin' ? 'Admin' : 'User';
    
    const query = { 
      recipient: userId,
      recipientModel: userModel
    };
    
    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }
    
    const options = {
      sort: { createdAt: -1 },
      limit: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit)
    };
    
    const notifications = await Notification.find(query, null, options);
    const total = await Notification.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    await logError(error, req, 'error');
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userModel = req.user.role === 'admin' ? 'Admin' : 'User';
    
    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: userId, recipientModel: userModel },
      { isRead: true },
      { new: true }
    );
    
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    
    res.status(200).json({ success: true, data: notification });
  } catch (error) {
    await logError(error, req, 'error');
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const userModel = req.user.role === 'admin' ? 'Admin' : 'User';
    
    await Notification.updateMany(
      { recipient: userId, recipientModel: userModel, isRead: false },
      { isRead: true }
    );
    
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    await logError(error, req, 'error');
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Delete a notification
exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userModel = req.user.role === 'admin' ? 'Admin' : 'User';
    
    const notification = await Notification.findOneAndDelete({
      _id: id,
      recipient: userId,
      recipientModel: userModel
    });
    
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    
    res.status(200).json({ success: true, message: 'Notification deleted successfully' });
  } catch (error) {
    await logError(error, req, 'error');
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Log user activity
exports.logActivity = async (req, res, next) => {
  try {
    const { user, action, entityType, entityId, details } = req.body;
    
    const activityLog = new ActivityLog({
      user: user._id,
      userModel: user.role === 'admin' ? 'Admin' : 'User',
      action,
      entityType,
      entityId,
      details,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    await activityLog.save();
    
    res.status(201).json({ success: true, data: activityLog });
  } catch (error) {
    await logError(error, req, 'error');
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get activity logs with filtering
exports.getActivityLogs = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      action, 
      entityType, 
      entityId,
      userId,
      userModel,
      startDate,
      endDate
    } = req.query;
    
    const query = {};
    
    if (action) query.action = action;
    if (entityType) query.entityType = entityType;
    if (entityId) query.entityId = entityId;
    if (userId) query.user = userId;
    if (userModel) query.userModel = userModel;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const options = {
      sort: { createdAt: -1 },
      limit: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit),
      populate: {
        path: 'user',
        select: 'name email'
      }
    };
    
    const logs = await ActivityLog.find(query, null, options);
    const total = await ActivityLog.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    await logError(error, req, 'error');
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get error logs with filtering
exports.getErrorLogs = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      level,
      statusCode,
      path,
      startDate,
      endDate
    } = req.query;
    
    const query = {};
    
    if (level) query.level = level;
    if (statusCode) query.statusCode = parseInt(statusCode);
    if (path) query.path = { $regex: path, $options: 'i' };
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const options = {
      sort: { createdAt: -1 },
      limit: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit)
    };
    
    const logs = await ErrorLog.find(query, null, options);
    const total = await ErrorLog.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    await logError(error, req, 'error');
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Helper function to log errors
const logError = async (error, req = {}, level = 'error') => {
  try {
    const errorLog = new ErrorLog({
      level,
      message: error.message || 'Unknown error occurred',
      stack: error.stack,
      path: req.originalUrl || 'unknown',
      method: req.method || 'unknown',
      statusCode: error.statusCode || 500,
      requestData: {
        body: req.body || {},
        params: req.params || {},
        query: req.query || {}
      },
      ipAddress: req.ip || 'unknown',
      userAgent: req.headers ? req.headers['user-agent'] : 'unknown',
      userId: req.user ? req.user._id : null,
      userType: req.user ? (req.user.role === 'admin' ? 'admin' : 'user') : null
    });
    
    await errorLog.save();
    return errorLog;
  } catch (err) {
    console.error('Error logging error:', err);
    return null;
  }
};

// Export the error logging function for use in other controllers
exports.logError = logError;