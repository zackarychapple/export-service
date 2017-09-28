import { ChildProcess, exec, spawn } from 'child_process';
import { EventEmitter } from 'events';

import { ChromeInstance } from '../support/ChromeInstance';
import {
  PROCESS_WAITING_PERIOD, HEALTH_CHECK_PERIOD, PORTRAIT_RESOLUTION, INSTANCES_CHECKING_PERIOD, INSTANCES_START_PORT
} from '../support/constants';

export class ChromeInstancesManager {

  private instancesActionEmitter = new EventEmitter();
  private instances: ChromeInstance[] = [];
  private pendingQueue: Function[] = [];
  private chromiumBinary: any;
  private runningInstances = new Map<number, ChildProcess>();

  // contains timestamp of last activity related to instance. <port, timestamp>
  private activities = new Map<number, number>();

  // if false, connections will not be respawned after closing
  private keepConnectionsAlive: boolean = true;
  private logger: any;

  constructor(chromiumBinary: any, instancesNumber: number, logger: any) {
    this.chromiumBinary = chromiumBinary;
    this.logger = logger;
    for (let i = 0; i < instancesNumber; i++) {

      // increment ports for each next instance. Instances unavailable at start
      const port = INSTANCES_START_PORT + i;
      this.instances.push({port, isIdle: false});
      this.runInstance(port);
    }

    this.instancesActionEmitter.on('change', (message: any) => {
      // stores activity related to port
      this.activities.set(message.port, new Date().getTime());
    });

    // check instances every <INSTANCES_CHECKING_PERIOD> ms
    setInterval(this.checkInstancesActivity.bind(this), INSTANCES_CHECKING_PERIOD);
  }

  public cloneInstancesState() {
    return JSON.parse(JSON.stringify(this.instances));
  }

  public getChromeProcessesNumber(cb: Function) {
    // get chrome child processes. Shall be 15 for 5 instances(Chrome Version 58.0.3029.110 (64-bit))
    exec('ps -A | grep chrome | wc -l', (error, stdout) => {
      if (error) {
        this.logger.error(`exec error: ${error}`);
        return cb(error, null);
      }
      if (stdout && !isNaN(parseInt(stdout, 10))) {
        return cb(null, parseInt(stdout, 10));
      }
      cb('No data received', null);
    });
  }

  private runInstance(port: number) {
    const process = spawn(this.chromiumBinary, [
      '--headless',
      '--no-sandbox',
      `--remote-debugging-port=${port}`,
      `--window-size=${PORTRAIT_RESOLUTION}`,
      '--hide-scrollbars'
    ]);
    const msg = `Spawning instance on ${port} port, PID: ${process.pid}`;
    this.logger.info(msg);

    // associate port with process and set process's initial activity timestamp
    this.runningInstances.set(port, process);
    this.activities.set(port, new Date().getTime());

    process.on('exit', (code: number, signal: string) => {
      this.logger.error(`Emitted "Exit" event. PID: ${process.pid}, port: ${port}, code: ${code}, signal: ${signal}`);
      this.respawnInstances();
    });

    process.on('error', (err: any) => {
      this.logger.error(`"Error" event was been emitted PID: ${process.pid}, port: ${port}. ${err}`);
      this.respawnInstances();
    });

    setTimeout(() => {
      this.setPortAsIdle(port);
    }, 500);
  }

  private respawnInstances() {
    if (!this.keepConnectionsAlive) {
      return;
    }

    this.runningInstances.forEach((value: any, key: number) => {
      if (value.killed || value.signalCode === 'SIGTERM') {
        this.runInstance(key);
      }
    });
  }

  // every <INSTANCES_CHECKING_PERIOD> ms, app will check instances, and if some was busy, greater than
  // <PROCESS_WAITING_PERIOD> ms - that processes will be destroyed
  private checkInstancesActivity() {
    const now = new Date().getTime();
    this.instances.forEach((instance: ChromeInstance) => {
      if (instance.isIdle) {
        return;
      }

      const actItem = this.activities.get(instance.port);
      if (actItem) {
        const busyTime = now - actItem;
        if (busyTime >= PROCESS_WAITING_PERIOD) {
          const msg = `Instance on port ${instance.port} is busy more than ${busyTime} ms and will been killed`;
          this.logger.warn(msg);
          this.killInstanceOn(instance.port);
        }
      }

      return;
    });
  }

  /**
   * Returns resolved promise, which "contains" free port immediately. If all ports is busy it will return promise
   * which will be resolved, when the port going to idle
   */
  public getFreePort(): Promise<any> {
    const instance = this.instances.find((item: ChromeInstance, index: number) => {
      if (item.isIdle) {
        this.instancesActionEmitter.emit('change', {port: item.port, status: 'busy'});
        this.instances[index].isIdle = false;
        return true;
      }
      return false;
    });

    // return found free instance
    if (instance) {
      return Promise.resolve(instance.port);
    }

    // add function for resolving 
    return new Promise((resolve: Function) => this.pendingQueue.push(resolve));
  }

  /**
   * marks instance on specified port as idle. If pending queue is not empty, it will pass this instance to first item
   * in queue. Also emits event, that instance status was been changed
   * @param {number} port
   */
  public setPortAsIdle(port: number): void {
    this.instancesActionEmitter.emit('change', {port, status: 'idle'});
    const index = this.instances.findIndex((item: any) => item.port === port);
    this.instances[index].isIdle = true;
    if (this.pendingQueue.length === 0) {
      return;
    }
    // pull top pending resolver function and invokes it with new freed instance. If queue is empty - do nothing
    const pendingResolver = this.pendingQueue.shift();
    if (pendingResolver) {
      this.instances[index].isIdle = false;
      this.instancesActionEmitter.emit('change', {port, status: 'busy'});
      pendingResolver(port);
    }
  }

  /**
   * logs all instances activities for some time and returns log via callback
   * @param {String} version
   * @param {Function} cb
   */
  public healthCheck(version: string, cb: Function) {
    let outString: string [] = ['Service version: ' + version];
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

    function formatResult(item: ChromeInstance) {
      const status = item.isIdle ? 'is idle' : 'is busy';
      return `Port: ${item.port} is ${status}`;
    }
  }

  public killInstanceOn(port: number) {
    const instance = this.runningInstances.get(port);
    if (instance) {
      const isKilled = instance.kill();
      const msg = `Process killed: PID ${instance.pid}, port: ${port} -> ` + isKilled;
      this.logger.info(msg);
      // if process not killed regular way - it may be a symptom, that it unavailable, so attempt to kill it via linux
      // command and run a new instance directly on port
      if (!isKilled) {
        const cmd = `kill ${instance.pid}`;
        this.logger.info(`Running a ${cmd}`);
        exec(cmd, (error) => {
          if (error) {
            this.logger.error(`exec error: ${error}`);
          }
          if (this.keepConnectionsAlive) {
            this.logger.warn(`Force running a child process on ${port} port`);
            this.runInstance(port);
          }
        });

      }
    }
  }

  /**
   * Will send to all chrome processes signal "exit"
   * @param {boolean} keepConnectionsAlive, if true will be created a new connection instead of killed, if false - not
   */
  public killInstances(keepConnectionsAlive: boolean) {
    this.keepConnectionsAlive = keepConnectionsAlive;
    this.runningInstances.forEach((value: ChildProcess, key: number) => {
      const isKilled = value.kill();
      const msg = `Process killed: PID ${value.pid}, port: ${key} -> ` + isKilled;
      this.logger.info(msg);
    });
  }

}
