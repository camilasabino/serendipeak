import { describe, it, expect } from 'vitest';
import { isPhotoHidden, photoAlt } from './primaryPhoto';

describe('photoAlt', () => {
	it('names the photograph after the mountain only', () => {
		expect(photoAlt('Mount Everest')).toBe('Photograph of Mount Everest');
	});
});

describe('isPhotoHidden', () => {
	it('shows a photo that has not failed', () => {
		expect(isPhotoHidden(undefined, 'a.jpg')).toBe(false);
	});

	it('hides the photo that failed', () => {
		expect(isPhotoHidden('a.jpg', 'a.jpg')).toBe(true);
	});

	it('shows the next mountain photo after a previous one failed', () => {
		expect(isPhotoHidden('a.jpg', 'b.jpg')).toBe(false);
	});
});
