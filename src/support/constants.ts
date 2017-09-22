const letterPortraitWidth = '1280';
const letterPortraitHeight = '1696';
const letterLandscapeWidth = '1696';
const letterLandscapeHeight = '1280';
export const PORTRAIT_RESOLUTION = `${letterPortraitWidth}x${letterPortraitHeight}`;
export const LANDSCAPE_RESOLUTION = `${letterLandscapeWidth}x${letterLandscapeHeight}`;

// time frame in ms, which will be spent to gather information for healthcheck route
export const HEALTH_CHECK_PERIOD = 30000;

// time frame in ms, which specifies, how much time app will wait responding from Chrome instance, after navigating to url.
// If response was been not received it will be a symptom, that browser hang in and request will be interrupted
// Chrome-interface level
export const CHROME_WAITING_PERIOD = 30000;

// frequency in ms, with which app will check instances. Will be used in interval
export const INSTANCES_CHECKING_PERIOD = 20000;

// if process marked as BUSY greater, than this parameter(in ms), it will be interrupted (ChildProcess level)
// Should be greater(and, probably multiple to INSTANCES_CHECKING_PERIOD)
export const PROCESS_WAITING_PERIOD = 40000;

export const DEFAULT_INSTANCES_NUMBER = 5;
export const INSTANCES_START_PORT = 9222;

// quantity of attempts, which will be used for receiving image from one specific url
export const ATTEMPTS_FOR_URL = 3;
