import {IChromeInstance} from '../support/ChromeInstance';
const Chrome = require('chrome-remote-interface');
import {debounce} from 'lodash';
import Timer = NodeJS.Timer;

interface Base64response {
  data: string;
}

export class ScreenshotMaker {

  /**
   * Will return Buffer with specified url content(screenshot, not all page)
   * @param {string} url
   * @param {IChromeInstance} instance
   * @param options
   * @param {Function} cb
   * @returns {any}
   */
  public getScreenShot(url: string, instance: IChromeInstance, options: {flagName: string, delay: number}, cb: Function) {
    const customEventName: string = (options.flagName) ? (options.flagName) : 'readyState';
    const delay: number = (options.delay) ? (options.delay) : 0;

    return Chrome({port: instance.port}, (chromeInstance: any) => {
      const {Page, Runtime} = chromeInstance;

      const exportFileDebounce: Function = debounce(async () => {

        try {
          const base64: Base64response = await chromeInstance.Page.captureScreenshot();

          cb(null, Buffer.from(base64.data, 'base64'));
        } catch (e) {
          cb(e, null);
        } finally {
          chromeInstance.close();
        }

      }, delay);

      Page.loadEventFired(() => {
        this.getEventStatusByName(Runtime.evaluate, customEventName, (error: Error) => {
          if (error) {
            console.error('Custom event status: ', error);
          }

          exportFileDebounce();
        });
      });

      Page.enable();
      Runtime.enable();

      chromeInstance.once('ready', () => {
        Page.navigate({url});
      });
    });
  }

  /**
   * Will create image from passed html string
   * @param {IChromeInstance} instance
   * @param {string} html
   * @param {Function} cb
   */
  public domToImage(instance: IChromeInstance, html: string, cb: Function ) {
    Chrome({port: instance.port}, (chromeInstance: any) => {
      chromeInstance.Runtime.evaluate({
        'expression': `document.getElementsByTagName('html')[0].innerHTML = \`${html}\``
      }, (error: Error, response: any) => {

        if (error) {
          console.error('Protocol error: ', error);
          chromeInstance.close();
          return cb(error, null);
        }

        if (response.wasThrown) {
          console.error('Evaluation error', response);
          chromeInstance.close();
          return cb('Evaluation error', null);
        }

        chromeInstance.Page.captureScreenshot().then((base64: Base64response) => {
          chromeInstance.close();
          cb(null, Buffer.from(base64.data, 'base64'))
        });
      })
    });
  }

  private getEventStatusByName(runtimeEvaluate: Function, customEventName: string, cb: Function): Function {
    return this.getPrerenderReadyStatus(runtimeEvaluate, customEventName, (error: Error, data: { isLoaded: boolean }):
      Function | Timer => {
      if (error) {
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
        return cb(error);
      }

      if (response.result.type === 'undefined') {
        return cb(`The custom event '${customEventName}' is not found`);
      }

      let isLoaded: boolean = false;

      if (response.result.value) {
        isLoaded = !!response.result.value;
      }

      return cb(null, {isLoaded});
    });
  }
}
