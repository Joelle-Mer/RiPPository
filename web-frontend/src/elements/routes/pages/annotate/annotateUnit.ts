import { createContext, useContext } from 'react';
import { ErrorUnit } from './annotateFormat';

// which unit every error on the page is shown in; the user picks it next to the tolerance
const ErrorUnitContext = createContext<ErrorUnit>('mDa');

function useErrorUnit() {
  return useContext(ErrorUnitContext);
}

export { ErrorUnitContext, useErrorUnit };
