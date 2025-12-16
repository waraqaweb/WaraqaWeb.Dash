import React from 'react';
import { render, screen } from '@testing-library/react';
import LibraryGrid from '../components/library/LibraryGrid';

jest.mock('../api/library', () => ({
	__esModule: true,
	fetchDocumentPages: jest.fn(async () => ({ pages: [] }))
}));

describe('LibraryGrid', () => {
	it('renders folders in the main grid', () => {
		render(
			<LibraryGrid
				folders={[{ _id: 'algebra', displayName: 'Algebra', subject: 'Mathematics', level: 'Grade 1' }]}
				items={[
					{
						_id: 'item1',
						displayName: 'Sample Book',
						description: 'Test',
						allowDownload: true,
						previewAsset: { url: 'https://example.com/preview.png' },
						subject: 'Mathematics',
						level: 'Grade 1',
						pageCount: 10
					}
				]}
				view="grid"
				onOpenItem={() => {}}
				onOpenFolder={() => {}}
			/>
		);

		expect(screen.getByRole('heading', { name: 'Algebra' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Sample Book' })).toBeTruthy();
	});

	it('renders folders in list view', () => {
		render(
			<LibraryGrid
				folders={[{ _id: 'algebra', displayName: 'Algebra' }]}
				items={[]}
				view="list"
				onOpenItem={() => {}}
				onOpenFolder={() => {}}
			/>
		);

		expect(screen.getByText('Folder')).toBeTruthy();
		expect(screen.getByText('Algebra')).toBeTruthy();
		expect(screen.getByText('Classification')).toBeTruthy();
	});
});
