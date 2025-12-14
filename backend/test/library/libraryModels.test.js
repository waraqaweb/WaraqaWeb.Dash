const { expect } = require('chai');
const mongoose = require('mongoose');

const LibraryFolder = require('../../models/library/LibraryFolder');
const LibraryItem = require('../../models/library/LibraryItem');
const LibrarySharePermission = require('../../models/library/LibrarySharePermission');
const LibraryAnnotationSnapshot = require('../../models/library/LibraryAnnotationSnapshot');

const objectId = () => new mongoose.Types.ObjectId();

describe('Library data models', () => {
  it('auto-generates a slug for folders', () => {
    const folder = new LibraryFolder({ displayName: 'Math Grade 1' });
    const error = folder.validateSync();
    expect(error).to.equal(undefined);
    expect(folder.slug).to.equal('math-grade-1');
  });

  it('checks secret folder access list', () => {
    const allowedUser = objectId();
    const folder = new LibraryFolder({
      displayName: 'Secret Exams',
      isSecret: true,
      secretAccessList: [{ user: allowedUser }]
    });
    expect(folder.allowsUser({ userId: allowedUser.toString() })).to.equal(true);
    expect(folder.allowsUser({ userId: objectId().toString() })).to.equal(false);
  });

  it('computes effective secret on items', () => {
    const item = new LibraryItem({
      folder: objectId(),
      displayName: 'Chemistry 101',
      storage: {
        resourceType: 'raw',
        publicId: 'waraqa/library/chemistry-101.pdf',
        folderPath: 'waraqa/library/science',
        fileName: 'chemistry-101.pdf',
        format: 'pdf',
        bytes: 1024,
        uploadedAt: new Date()
      },
      createdBy: objectId(),
      inheritsSecret: true
    });
    const validation = item.validateSync();
    expect(validation).to.equal(undefined);
    expect(item.effectiveSecret).to.equal(true);
  });

  it('verifies share permission activity state', () => {
    const permission = new LibrarySharePermission({
      scopeType: 'item',
      targetItem: objectId(),
      status: 'approved',
      downloadAllowed: true,
      expiresAt: new Date(Date.now() + 3600 * 1000)
    });
    expect(permission.isActive()).to.equal(true);
    permission.expiresAt = new Date(Date.now() - 1000);
    expect(permission.isActive()).to.equal(false);
  });

  it('handles annotation version bumping', () => {
    const snapshot = new LibraryAnnotationSnapshot({
      item: objectId(),
      user: objectId(),
      pageNumber: 1
    });
    expect(snapshot.version).to.equal(1);
    snapshot.bumpVersion();
    expect(snapshot.version).to.equal(2);
  });
});
