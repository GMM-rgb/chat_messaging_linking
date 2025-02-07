const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

const app = express();
app.use(bodyParser.json());

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Serve static files from the uploads folder
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = process.env.PORT || 3000;  // Updated for external access
const USERS_FILE = 'users.json';
const MESSAGES_FILE = 'messages.json';
const UPLOADS_DIR = 'uploads';

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// Create user images directory if it doesn't exist
const USER_IMAGES_DIR = 'user_account_images';
if (!fs.existsSync(USER_IMAGES_DIR)) {
  fs.mkdirSync(USER_IMAGES_DIR);
}

// Setup multer storage to use conversation-specific folders
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use conversationId from request body to determine folder
    let convId = req.body.conversationId;
    if (!convId) convId = 'general';
    const convPath = path.join(UPLOADS_DIR, convId);
    if (!fs.existsSync(convPath)) {
      fs.mkdirSync(convPath, { recursive: true });
    }
    cb(null, convPath);
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Setup user image storage
const userImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.body.userId;
    const userDir = path.join(USER_IMAGES_DIR, userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'profile' + path.extname(file.originalname));
  }
});

const uploadUserImage = multer({ storage: userImageStorage });

// Load users and messages from JSON files
const loadUsers = () => JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
const saveUsers = (users) => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

const loadMessages = () => JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
const saveMessages = (messages) => fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));

// Initialize users and messages
if (!fs.existsSync(USERS_FILE)) saveUsers([]);
if (!fs.existsSync(MESSAGES_FILE)) saveMessages([]);

// Signup endpoint
app.post('/signup', (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();

  if (users.find(user => user.username === username)) {
    return res.status(400).send('Username already exists');
  }

  const newUser = {
    id: uuidv4(),
    username,
    password,
    friends: []
  };

  users.push(newUser);
  saveUsers(users);
  res.status(201).send('User created successfully');
});

// Updated login endpoint with friendship verification
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();

  const user = users.find(user => user.username === username && user.password === password);
  if (user) {
    // Verify and fix bidirectional friendships
    let needsSave = false;
    users.forEach(otherUser => {
      if (otherUser.friends.includes(username) && !user.friends.includes(otherUser.username)) {
        user.friends.push(otherUser.username);
        needsSave = true;
        console.log(`Fixed one-way friendship: ${username} -> ${otherUser.username}`);
      }
    });
    if (needsSave) {
      saveUsers(users);
    }
    return res.status(200).json({ id: user.id, username: user.username });
  } else {
    return res.status(400).send('Invalid username or password');
  }
});

// Send friend request endpoint
app.post('/friend-request', (req, res) => {
  const { fromUsername, toUsername } = req.body;
  const users = loadUsers();

  const fromUser = users.find(user => user.username === fromUsername);
  const toUser = users.find(user => user.username === toUsername);

  if (!fromUser || !toUser) {
    return res.status(400).send('User not found');
  }

  if (toUser.friends.includes(fromUsername)) {
    return res.status(400).send('Already friends');
  }

  toUser.friends.push(fromUsername);
  fromUser.friends.push(toUsername);
  saveUsers(users);
  res.status(200).send('Friend request accepted');
});

// Updated message endpoint
app.post('/message', (req, res) => {
  const { fromUsername, conversationId, message } = req.body;
  if (!fromUsername || !conversationId || !message) {
    return res.status(400).send('Missing required fields');
  }

  const messages = loadMessages();
  const newMessage = {
    id: uuidv4(),
    fromUsername,
    conversationId,
    message,
    timestamp: new Date().toISOString(),
    type: 'message'  // Add type to distinguish from chat/system messages
  };

  messages.push(newMessage);
  saveMessages(messages);
  res.status(200).json(newMessage);  // Return the created message
});

// Updated file upload endpoint with conversation folder check and access validation placeholder
app.post('/upload', (req, res, next) => {
  const { conversationId, fromUsername, toUsername } = req.body;
  if (!conversationId) {
    return res.status(400).send('No conversation ID provided');
  }
  // TODO: Validate that conversationId exists and is accessible by fromUsername/toUsername
  next();
}, upload.single('file'), (req, res) => {
  const { conversationId, fromUsername, toUsername } = req.body;
  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const fromUser = users.find(user => user.username === fromUsername);
  const toUser = users.find(user => user.username === toUsername);

  if (!fromUser || !toUser) {
    return res.status(400).send('User not found');
  }
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }
  // Save file upload as a message with fileUrl property
  const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
  const fileMessage = {
    id: uuidv4(),
    fromUsername,
    toUsername,
    conversationId,
    fileUrl: path.join(conversationId, req.file.filename), // relative path inside uploads
    timestamp: new Date().toISOString()
  };
  messages.push(fileMessage);
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  res.status(200).send({ message: 'File uploaded and message sent successfully', file: req.file });
});

// New endpoint for creating a chat
app.post('/new-chat', (req, res) => {
  const { conversationName } = req.body;
  if (!conversationName) return res.status(400).send('Conversation name required');
  const conversationId = uuidv4();
  // Create conversation folder in uploads
  const convPath = path.join(UPLOADS_DIR, conversationId);
  if (!fs.existsSync(convPath)) {
    fs.mkdirSync(convPath, { recursive: true });
  }
  // Save the new chat as a system message in messages.json
  const messages = loadMessages();
  const newChat = {
    id: conversationId,
    conversationName,
    type: "chat",
    timestamp: new Date().toISOString()
  };
  messages.push(newChat);
  saveMessages(messages);
  res.status(200).send({ conversationId, conversationName });
});

// New endpoint for deleting a chat
app.delete('/delete-chat', (req, res) => {
  const { conversationId } = req.body;
  if (!conversationId) return res.status(400).send("Missing conversationId");
  // Remove from messages file (remove all items from that conversation)
  let messages = loadMessages();
  messages = messages.filter(msg => msg.conversationId !== conversationId && msg.id !== conversationId);
  saveMessages(messages);
  // Delete uploads folder for the conversation
  const convPath = path.join(UPLOADS_DIR, conversationId);
  if (fs.existsSync(convPath)) {
    fs.rmdirSync(convPath, { recursive: true });
  }
  res.status(200).send("Chat deleted successfully");
});

// New endpoint to get friend list for a given username
app.get('/friends', (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).send("Username query parameter required");
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).send("User not found");
  // For each friend, return their username, a dummy profileImage, and a dummy status
  const friendDetails = user.friends.map(friendName => {
    const friend = users.find(u => u.username === friendName) || {};
    return {
      username: friendName,
      profileImage: friend.profileImage || '/images/default.png',
      status: friend.status || "online"  // simulate online status
    };
  });
  res.status(200).json(friendDetails);
});

// Update messages endpoint to include more message types
app.get('/messages', (req, res) => {
  const conversationId = req.query.conversationId;
  if (!conversationId) return res.status(400).send("conversationId required");
  
  let messages = loadMessages();
  console.log(`Loading messages for conversation: ${conversationId}`);
  
  // Include all message types associated with this conversation
  messages = messages.filter(msg => {
    const isConversationMessage = msg.conversationId === conversationId;
    const isFileMessage = msg.fileUrl && msg.conversationId === conversationId;
    const isChatMessage = msg.id === conversationId; // Chat creation message
    
    return isConversationMessage || isFileMessage || isChatMessage;
  });
  
  console.log(`Found ${messages.length} messages`);
  res.status(200).json(messages);
});

// New endpoint to retrieve chats for a given userId
app.get('/user-chats', (req, res) => {
  const userId = req.query.userId;
  if(!userId) return res.status(400).send("userId required");
  
  const messages = loadMessages();
  console.log('Finding chats for user:', userId);
  
  // Get all chats where user is either creator or participant
  const userChats = messages.filter(chat => {
    const isParticipant = chat.participants && chat.participants.includes(userId);
    const isCreator = chat.creator === userId;
    const isPublic = chat.type === "chat"; // System/public chats
    
    console.log(`Chat ${chat.id}: participant=${isParticipant}, creator=${isCreator}, public=${isPublic}`);
    return isParticipant || isCreator || isPublic;
  });
  
  // Split into created and received chats
  const yourChats = userChats.filter(chat => chat.creator === userId);
  const friendChats = userChats.filter(chat => chat.creator !== userId);
  
  console.log(`Found ${yourChats.length} created chats and ${friendChats.length} received chats`);
  res.status(200).json({ yourChats, friendChats });
});

// Updated friend chat creation endpoint to use user id's
app.post('/create-friend-chat', (req, res) => {
  const { fromUserId, toUserId, initialMessage, conversationName } = req.body;
  if (!fromUserId || !toUserId) {
    return res.status(400).send("Both fromUserId and toUserId required");
  }
  let convName = conversationName;
  if (!convName) {
    if (initialMessage) {
      convName = initialMessage.split(" ").slice(0, 2).join(" ");
    } else {
      convName = "Friend Chat";
    }
  }
  const conversationId = uuidv4();
  const convPath = path.join(UPLOADS_DIR, conversationId);
  if (!fs.existsSync(convPath)) {
    fs.mkdirSync(convPath, { recursive: true });
  }
  const messages = loadMessages();
  const friendChat = {
    id: conversationId,
    conversationName: convName,
    type: "friend-chat",
    creator: fromUserId,
    participants: [fromUserId, toUserId],
    timestamp: new Date().toISOString()
  };
  messages.push(friendChat);
  saveMessages(messages);
  res.status(200).send(friendChat);
});

// Add new endpoints for account management
app.post('/update-profile-image', uploadUserImage.single('profileImage'), (req, res) => {
  const { userId } = req.body;
  if (!userId || !req.file) {
    return res.status(400).send('Missing user ID or file');
  }

  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).send('User not found');

  user.profileImage = path.join(userId, req.file.filename);
  saveUsers(users);
  res.status(200).json({ profileImage: user.profileImage });
});

app.post('/change-password', (req, res) => {
  const { userId, oldPassword, newPassword } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.id === userId);

  if (!user) return res.status(404).send('User not found');
  if (user.password !== oldPassword) return res.status(401).send('Invalid current password');

  user.password = newPassword;
  saveUsers(users);
  res.status(200).send('Password updated successfully');
});

// Serve user profile images
app.use('/user-images', express.static(USER_IMAGES_DIR));

// Start server binding to all network interfaces
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
