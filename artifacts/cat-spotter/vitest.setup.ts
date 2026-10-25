import { configure } from '@testing-library/react';

// waitFor / findBy* give up after 1 s by default. On a busy machine or a CI
// runner a screen can take longer than that to settle, and the test fails
// with a timing error that has nothing to do with the change under test
// (SYC-465). Five seconds still fails a real hang quickly.
configure({ asyncUtilTimeout: 5000 });
