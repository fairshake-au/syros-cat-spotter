// @vitest-environment jsdom
/**
 * SYC-415 (spec §4.1, plan Task 4.6): the "Add the face" and "Add the whole
 * body" boxes on the New spot screen. Each empty box has two buttons, Camera
 * and Photos, that open the picker straight from the tap (browsers only open
 * a camera or file chooser from a direct tap, so there is no pop-up).
 */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({
  Image: ({ source, testID }: { source: { uri: string }; testID?: string }) =>
    React.createElement('img', { src: source.uri, 'data-testid': testID }),
}));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#000' }) }));
vi.mock('react-native-svg', () => {
  const El = ({ children, accessibilityLabel }: any) =>
    React.createElement('svg', { 'aria-label': accessibilityLabel }, children);
  const Leaf = () => null;
  return {
    __esModule: true,
    default: El,
    Svg: El,
    G: Leaf,
    Rect: Leaf,
    Circle: Leaf,
    Ellipse: Leaf,
    Path: Leaf,
    Defs: Leaf,
    ClipPath: Leaf,
  };
});

import { ExtraPhotoBoxes } from '../ExtraPhotoBoxes';
import { TRANSLATIONS } from '@/lib/i18n';

afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof ExtraPhotoBoxes>> = {}) {
  const props = {
    extras: {},
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    ...over,
  };
  return { ...render(<ExtraPhotoBoxes {...props} />), props };
}

const byId = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

/** The min width/height in force on an element, from it or the nearest ancestor that sets one. */
function tapSize(el: HTMLElement): { w: number; h: number } {
  let w = 0;
  let h = 0;
  let node: HTMLElement | null = el;
  while (node && (!w || !h)) {
    const cs = getComputedStyle(node);
    w ||= parseFloat(cs.minWidth) || 0;
    h ||= parseFloat(cs.minHeight) || 0;
    node = node.parentElement;
  }
  return { w, h };
}

describe('ExtraPhotoBoxes', () => {
  it('shows the line, then two empty boxes, each labelled for screen readers, with two buttons', () => {
    const { container, getByText } = setup();
    expect(getByText('extraPhotosLine')).toBeTruthy();
    const face = byId(container, 'extra-box-face')!;
    const body = byId(container, 'extra-box-body')!;
    expect(face.getAttribute('aria-label')).toBe('addFaceA11y');
    expect(body.getAttribute('aria-label')).toBe('addBodyA11y');
    expect(face.textContent).toContain('addFace');
    expect(body.textContent).toContain('addBody');
    for (const id of ['extra-face-camera', 'extra-face-library', 'extra-body-camera', 'extra-body-library']) {
      const button = byId(container, id);
      expect(button, id).not.toBeNull();
      expect(button!.getAttribute('role')).toBe('button');
    }
    expect(byId(container, 'extra-face-camera')!.textContent).toContain('extraCamera');
    expect(byId(container, 'extra-face-library')!.textContent).toContain('extraLibrary');
    expect(byId(container, 'extra-face-remove')).toBeNull();
  });

  it('opens the right picker for the right box, straight from the tap', () => {
    const { container, props } = setup();
    fireEvent.click(byId(container, 'extra-face-library')!);
    expect(props.onAdd).toHaveBeenLastCalledWith('face', 'library');
    fireEvent.click(byId(container, 'extra-body-camera')!);
    expect(props.onAdd).toHaveBeenLastCalledWith('body', 'camera');
    fireEvent.click(byId(container, 'extra-face-camera')!);
    expect(props.onAdd).toHaveBeenLastCalledWith('face', 'camera');
    fireEvent.click(byId(container, 'extra-body-library')!);
    expect(props.onAdd).toHaveBeenLastCalledWith('body', 'library');
    expect(props.onAdd).toHaveBeenCalledTimes(4);
  });

  it('a filled box shows the photo, says it is added, and has a Remove button', () => {
    const { container, props } = setup({ extras: { face: { uri: 'blob:face' } } });
    const face = byId(container, 'extra-box-face')!;
    expect(face.getAttribute('aria-label')).toBe('faceAddedA11y');
    expect(face.querySelector('img')?.getAttribute('src')).toBe('blob:face');
    // Read as "Remove the face photo", never "Remove: Add the face".
    expect(byId(container, 'extra-face-remove')!.getAttribute('aria-label')).toBe('removeFaceA11y');
    fireEvent.click(byId(container, 'extra-face-remove')!);
    expect(props.onRemove).toHaveBeenCalledWith('face');
    // The other box is still empty.
    expect(byId(container, 'extra-box-body')!.getAttribute('aria-label')).toBe('addBodyA11y');
    expect(byId(container, 'extra-body-remove')).toBeNull();
  });

  it('tapping a filled photo offers Camera and Photos again, to replace it', () => {
    const { container, props } = setup({ extras: { body: { uri: 'blob:body' } } });
    expect(byId(container, 'extra-body-camera')).toBeNull();
    fireEvent.click(byId(container, 'extra-body-photo')!);
    fireEvent.click(byId(container, 'extra-body-library')!);
    expect(props.onAdd).toHaveBeenCalledWith('body', 'library');
  });

  it('every button is at least 44 by 44', () => {
    const { container } = setup({ extras: { face: { uri: 'blob:face' } } });
    fireEvent.click(byId(container, 'extra-face-photo')!);
    for (const id of [
      'extra-face-camera',
      'extra-face-library',
      'extra-face-remove',
      'extra-body-camera',
      'extra-body-library',
    ]) {
      const size = tapSize(byId(container, id)!);
      expect({ id, w: size.w >= 44, h: size.h >= 44 }).toEqual({ id, w: true, h: true });
    }
  });

  it('nothing can be tapped while the spot is being sent', () => {
    const { container, props } = setup({ disabled: true, extras: { face: { uri: 'blob:face' } } });
    fireEvent.click(byId(container, 'extra-body-camera')!);
    fireEvent.click(byId(container, 'extra-face-remove')!);
    expect(props.onAdd).not.toHaveBeenCalled();
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it('every new string is in English, Greek and French', () => {
    const keys = [
      'extraPhotosLine', 'addFace', 'addBody', 'extraCamera', 'extraLibrary',
      'addFaceA11y', 'addBodyA11y', 'faceAddedA11y', 'bodyAddedA11y', 'extraReplaceA11yHint',
      'removePhoto', 'extraDifferentVisit', 'extraRemovedAfterRetake', 'extraDuplicate',
      'extraTooLarge', 'extraMissingNote', 'extraNotKeptNote', 'extraPhotoRejected',
      'whichFace', 'whichBody', 'spotTooLarge',
      'startAgain', 'removeFaceA11y', 'removeBodyA11y', 'extraRemovedDuplicate',
    ];
    for (const lang of ['en', 'el', 'fr'] as const) {
      for (const k of keys) expect((TRANSLATIONS as any)[lang][k], `${lang}.${k}`).toBeTruthy();
    }
    // t() does no interpolation: single-brace placeholders, the same in every language.
    for (const lang of ['en', 'el', 'fr'] as const) {
      expect((TRANSLATIONS as any)[lang].extraDifferentVisit).toContain('{when}');
      expect((TRANSLATIONS as any)[lang].extraRemovedAfterRetake).toContain('{which}');
      expect((TRANSLATIONS as any)[lang].extraPhotoRejected).toContain('{which}');
      expect((TRANSLATIONS as any)[lang].extraRemovedDuplicate).toContain('{which}');
      // The back arrow throws the whole spot away: it must not be read as "Retake photo".
      expect((TRANSLATIONS as any)[lang].startAgain).not.toBe((TRANSLATIONS as any)[lang].retakePhoto);
    }
  });
});
