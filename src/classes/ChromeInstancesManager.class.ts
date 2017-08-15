import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';

import { IChromeInstance } from '../support/ChromeInstance';
import { HEALTH_CHECK_PERIOD, PORTRAIT_RESOLUTION } from '../support/constants';

export class ChromeInstancesManager {

  private instancesActionEmitter = new EventEmitter();
  private instances: IChromeInstance[] = [
    {port: 9222, isIdle: true},
    {port: 9223, isIdle: true},
    {port: 9224, isIdle: true},
    {port: 9225, isIdle: true},
    {port: 9226, isIdle: true}
  ];
  private pendingQueue: Function[] = [];
  private chromiumBinary: any;
  private runnedInstances: ChildProcess[] = [];

  constructor(chromiumBinary: any) {
    this.chromiumBinary = chromiumBinary;
  }

  public cloneInstancesState() {
    return JSON.parse(JSON.stringify(this.instances));
  }

  public runInstances() {
    this.instances.forEach((item: IChromeInstance) => {
      const process = spawn(this.chromiumBinary, [
        '--headless',
        '--no-sandbox',
        `--remote-debugging-port=${item.port}`,
        `--window-size=${PORTRAIT_RESOLUTION}`,
        '--hide-scrollbars'
      ]);
      this.runnedInstances.push(process);
    });
  }

  /**
   * Returns(callback) free idle chrome instance. If all instances is busy it will add pending callback to queue
   * also emits event, that instance status was been changed
   * @param {Function} cb
   */
  public getFreeInstance(cb: Function): void {
    const instance = this.instances.find((item: IChromeInstance, index: number) => {
      if (item.isIdle) {
        this.instancesActionEmitter.emit('change', {port: item.port, status: 'busy'});
        this.instances[index].isIdle = false;
        return true;
      }
      return false;
    });

    if (instance) {
      // return found free instance
      return cb(instance);
    }

    // free instance not found, add callback to queue(to tail)
    this.pendingQueue.push(cb);
  }

  /**
   * marks specified instance as idle. If pending queue is not empty will pass this instance to first item in queue
   * also emits event, that instance status was been changed
   * @param {IChromeInstance} instance
   * @returns {any}
   */
  public setInstanceAsIdle(instance: IChromeInstance) {
    this.instancesActionEmitter.emit('change', {port: instance.port, status: 'idle'});
    const index = this.instances.findIndex((item: any) => item.port === instance.port);
    this.instances[index].isIdle = true;
    if (this.pendingQueue.length === 0) {
      return;
    }

    // pull top pending callback and pass new freed instance to it. If queue is empty - do nothing
    const pendingItemCallback = this.pendingQueue.shift();
    if (pendingItemCallback) {
      this.instances[index].isIdle = false;
      this.instancesActionEmitter.emit('change', {port: instance.port, status: 'busy'});
      return pendingItemCallback(instance);
    }
  }

  /**
   * logs all instances activities for some time and returns log via callback
   * @param {Function} cb
   */
  public healthCheck(cb: Function) {
    let outString: string [] = [];
    const initialState = this.cloneInstancesState().map(formatResult);
    outString.push('Initial state:');
    outString = outString.concat(initialState);
    outString.push(' ');
    outString.push('Activity on 30 second', '---------------------');

    this.instancesActionEmitter.on('change', changed);

    function changed(message: {port: number, status: string}) {
      outString.push(`instance on port ${message.port} is sets to ${message.status}`);
    }

    setTimeout(() => {
      this.instancesActionEmitter.removeListener('free-connection', changed);

      const finalState = this.cloneInstancesState().map(formatResult);
      outString.push(' ', 'Final state:');
      outString = outString.concat(finalState);

      cb(outString.join('\r\n'));
    }, HEALTH_CHECK_PERIOD);

    function formatResult(item: IChromeInstance) {
      const status = item.isIdle ? 'is idle' : 'is busy';
      return `Port: ${item.port} is ${status}`;
    }
  }

}