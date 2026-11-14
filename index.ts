import { registerRootComponent } from 'expo';

import App from './App';
import { registerWidgets } from './src/widgets';
import { registerCareTask } from './src/services/careTask'; // defines the background push task at module level
import { registerRescheduleTask } from './src/services/rescheduleTask'; // defines the background re-plan task at module level

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
registerWidgets(); // Android home-screen widget headless task (no-op elsewhere)
registerCareTask(); // caregiver: patient's dose push cancels the local late alarm, app closed or not
registerRescheduleTask(); // re-plans reminders a few times a day while the app stays closed
