const Chrome = require('chrome-remote-interface');
import {debounce} from 'lodash';
import Timer = NodeJS.Timer;

import { CHROME_WAITING_PERIOD } from '../support/constants';

interface Base64response {
  data: string;
}

export class ScreenshotMaker {

  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Will return Buffer with specified url content(screenshot, not all page)
   * @param {string} url
   * @param {number} port
   * @param options
   * @returns {any}
   */
  public makeScreenshot(url: string, port: number, options: {flagName: string, delay: number}): Promise<any> {
    const customEventName: string = (options.flagName) ? (options.flagName) : 'readyState';
    const delay: number = (options.delay) ? (options.delay) : 0;
    let resolve: Function;
    let reject: Function;
    const resultPromise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    Chrome({port}, (chromeInstance: any) => {
      const {Page, Runtime} = chromeInstance;

      // attempt to catch a hanging up (endless loop on requested page or something similar),
      // if response not received for specific term - waiting for response will be interrupted
      const waitingTimeout = setTimeout(() => {
        chromeInstance.close();
        const msg = `getScreenShot method. Error receiving data(timeout of page response exceeded), url: ${url}`;
        this.logger.warn(msg);
        reject('Error receiving data(timeout of page response exceeded)');
      }, CHROME_WAITING_PERIOD);

      const exportFileDebounce: Function = debounce(async () => {

        try {
          const base64: Base64response = await chromeInstance.Page.captureScreenshot();
          resolve(Buffer.from(base64.data, 'base64'));
        } catch (e) {
          reject(e);
        } finally {
          if (waitingTimeout) {
            // response received, drop timeout
            clearTimeout(waitingTimeout);
          }
          chromeInstance.close();
        }

      }, delay);

      Page.loadEventFired(() => {
        this.getEventStatusByName(Runtime.evaluate, customEventName, (error: Error) => {
          if (error) {
            const msg = `Custom event status: ${customEventName}`;
            this.logger.warn(msg);
            console.error('Custom event status: ', error);
          }

          exportFileDebounce();
        });
      });

      Page.enable();
      Runtime.enable();

      chromeInstance.once('ready', () => {
        Page.navigate({url}).catch((err: Error) => {

          // navigation failed, for example in case of invalid url
          if (chromeInstance) {
            chromeInstance.close();
          }
          if (waitingTimeout) {
            clearTimeout(waitingTimeout);
          }

          return Promise.reject(err);
        });
      });
    }).on('error', (err: Error) => {
      const msg = 'getScreenShot general error. ' + err.toString();
      this.logger.error(msg);
      reject(err);
    });

    return resultPromise;
  }

  /**
   * Will create image from passed html string
   * @param {number} port
   * @param {string} html
   */
  public domToImage(port: number, html: string,): Promise<any> {
    let resolve: Function;
    let reject: Function;
    const resultPromise = new Promise((res: Function, rej: Function) => {
      resolve = res;
      reject = rej;
    });
    Chrome({port}, (chromeInstance: any) => {
      chromeInstance.Runtime.evaluate({
        'expression': `document.getElementsByTagName('html')[0].innerHTML = \`${html}\``
      }, (error: Error, response: any) => {

        if (error) {
          const msg = 'Error. DOM to Image: ' + error.toString();
          this.logger.error(msg);
          chromeInstance.close();
          return reject(error);
        }

        if (response.wasThrown) {
          this.logger.error('Thrown. DOM to Image: ' + response);
          chromeInstance.close();
          return reject('Evaluation error');
        }

        chromeInstance.Page.captureScreenshot().then((base64: Base64response) => {
          chromeInstance.close();
          resolve(Buffer.from(base64.data, 'base64'))
        });
      })
    });
      return resultPromise;
  }

  private getEventStatusByName(runtimeEvaluate: Function, customEventName: string, cb: Function): Function {
    return this.getPrerenderReadyStatus(runtimeEvaluate, customEventName, (error: Error, data: { isLoaded: boolean }):
      Function | Timer => {
      if (error) {
        this.logger.error('getEventStatusByName error: ' + error);
        return cb(error);
      }

      if (data.isLoaded) {
        return cb(null, null);
      }

      return setTimeout((): Function => {
        return this.getEventStatusByName(runtimeEvaluate, customEventName, cb);
      }, 100);
    });
  }

  private getPrerenderReadyStatus(runtimeEvaluate: Function, customEventName: string, cb: Function): Function {
    return runtimeEvaluate({
      'expression': `document.${customEventName}`
    }, (error: Error, response: any): Function => {
      if (error) {
        this.logger.error('getPrerenderReadyStatus error: ' + error);
        return cb(error);
      }

      if (response.result.type === 'undefined') {
        const msg = `The custom event '${customEventName}' is not found`;
        this.logger.error(msg);
        return cb(msg);
      }

      let isLoaded: boolean = false;

      if (response.result.value) {
        isLoaded = !!response.result.value;
      }

      return cb(null, {isLoaded});
    });
  }
}
