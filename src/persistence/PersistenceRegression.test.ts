import { runPersistenceRegression } from './PersistenceRegression';

void runPersistenceRegression()
  .then(() => {
    console.log('Persistence regression tests passed');
  })
  .catch(error => {
    console.error(error);
    throw error;
  });
