const express = require('express');
const request = require('supertest');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { expect } = require('chai');
const multer = require('multer');

// Stub auth middleware
const authStub = (req, res, next) => {
  req.user = { id: 'user1', role: 'guardian', _id: 'user1' };
  next();
};

// Minimal in-memory users store
const users = {
  user1: { _id: 'user1', profilePicture: null, profilePicturePublicId: null, profilePictureThumbnail: null, profilePictureThumbnailPublicId: null }
};

const UserStub = {
  findById: (id) => {
    const user = users[id];
    if (!user) return null;
    // return object that mimics Mongoose Document with .select and .save
    return {
      ...user,
      save: async function () { users[id] = { ...this }; return this; },
      select: function () { return Promise.resolve({ ...users[id] }); }
    };
  }
};

// Stub cloudinary service
const cloudStub = {
  uploadImage: async (dataUri, opts) => {
    return {
      main: { secure_url: 'https://cdn.example.com/main.jpg', public_id: 'main_id' },
      thumb: { secure_url: 'https://cdn.example.com/thumb.jpg', public_id: 'thumb_id' }
    };
  },
  deleteImage: async (ids) => {
    return ids;
  }
};

// Load router with stubs
const usersRouter = proxyquire('../routes/users', {
  '../models/User': UserStub,
  '../services/cloudinaryService': cloudStub,
  '../middleware/auth': { authenticateToken: authStub, requireAdmin: () => (req,res,next)=>next(), requireResourceAccess: () => (req,res,next)=>next() }
});

const app = express();
app.use(express.json());
app.use('/api/users', usersRouter);

describe('Profile picture endpoints', function() {
  it('uploads a profile picture', async function() {
    const res = await request(app)
      .post('/api/users/user1/profile-picture')
      .attach('file', Buffer.from('fake'), 'avatar.jpg');

    expect(res.status).to.equal(200);
    expect(res.body.user.profilePicture).to.equal('https://cdn.example.com/main.jpg');
    expect(res.body.user.profilePictureThumbnail).to.equal('https://cdn.example.com/thumb.jpg');
  });

  it('deletes a profile picture', async function() {
    // set initial values
    users.user1.profilePicturePublicId = 'main_id';
    users.user1.profilePictureThumbnailPublicId = 'thumb_id';

    const res = await request(app)
      .delete('/api/users/user1/profile-picture');

    expect(res.status).to.equal(200);
    expect(res.body.user.profilePicture).to.equal(null);
    expect(res.body.user.profilePictureThumbnail).to.equal(null);
  });
});
