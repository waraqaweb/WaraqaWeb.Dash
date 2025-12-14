const { expect } = require('chai');
const sinon = require('sinon');
const mongoose = require('mongoose');
const proxyquire = require('proxyquire').noCallThru();

const makeObjectId = () => new mongoose.Types.ObjectId();

function loadService({ permissions = [], folders = [] }) {
  const shareFindStub = sinon.stub().resolves(permissions);
  const folderFindStub = sinon.stub().resolves(folders);
  const service = proxyquire('../../services/libraryPermissionsService', {
    '../models/library/LibrarySharePermission': { find: shareFindStub },
    '../models/library/LibraryFolder': { find: folderFindStub }
  });
  return { service, shareFindStub, folderFindStub };
}

describe('libraryPermissionsService', () => {
  it('grants folder access via descendant expansion', async () => {
    const folderId = makeObjectId();
    const childFolderId = makeObjectId();
    const permissions = [
      {
        scopeType: 'folder',
        targetFolder: folderId,
        includeDescendants: true,
        downloadAllowed: true,
        isActive: () => true
      }
    ];
    const folders = [{ _id: folderId }, { _id: childFolderId }];
    const { service } = loadService({ permissions, folders });

    const context = await service.getUserAccessContext({ user: { _id: makeObjectId(), email: 'teacher@test.com', role: 'teacher' } });
    expect(context.share.folderIds.has(folderId.toString())).to.equal(true);
    expect(context.share.folderIds.has(childFolderId.toString())).to.equal(true);
    expect(context.share.downloadFolderIds.has(folderId.toString())).to.equal(true);
  });

  it('detects space-wide permissions', async () => {
    const permissions = [
      {
        scopeType: 'space',
        downloadAllowed: false,
        isActive: () => true
      }
    ];
    const { service } = loadService({ permissions });
    const context = await service.getUserAccessContext({ user: { _id: makeObjectId(), role: 'teacher', email: 'demo@test.com' } });
    expect(context.share.spaceAccess).to.equal(true);
    expect(context.share.spaceDownload).to.equal(false);
  });
});
