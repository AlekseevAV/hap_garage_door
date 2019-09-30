let Accessory = require('../').Accessory;
let Service = require('../').Service;
let Characteristic = require('../').Characteristic;
let uuid = require('../').uuid;
const axios = require('axios');


let options = {
  name: 'Гаражные ворота',
  moduleName: 'GarageDoor',
  openSwitch: {
    ip: '192.168.0.91',
    channel: '4',
    password: 'sec'
  },
  closeSwitch: {
    ip: '192.168.0.91',
    channel: '4',
    password: 'sec'
  },
  door: {
    ip: '192.168.0.91',
    channel: '4',
    password: 'sec'
  }
};


class Relay {
  constructor(ip, password, channel) {
    this.ip = ip;
    this.password = password;
    this.channel = channel;
  }

  get url() {
    return `http://${this.ip}/${this.password}/`
  }

  async sendCommand(cmd) {
    let params = `cmd=${this.channel}:${cmd}`;
    return await this.makeRequest(params);
  }

  async getState() {
    let params = `pt=${this.channel}&cmd=get`;
    return await this.makeRequest(params);
  }

  async isPowerOn() {
    const response = await this.getState();
    const state = response.data.split('/', 1)[0];
    switch (state) {
      case 'ON':
        return true;
      case 'OFF':
        return false;
      default:
        console.error(`Unexpected state: ${response.data}`)
    }
  }

  async makeRequest(params) {
    const url = `${this.url}?${params}`;
    try {
      return await axios.get(url);
    } catch (error) {
      console.error(error);
    }
  }
}


class Switch extends Relay {
  async isActive() {
    return await this.isPowerOn();
  }
}


const OPEN = 0,
  CLOSED = 1,
  OPENING = 2,
  CLOSING = 3,
  STOPPED = 4;


class GarageDoor extends Relay {
  constructor (ip, password, channel, openSwitchConfig, closeSwitchConfig) {
    super(ip, password, channel);
    this.openSwitch = new Switch(openSwitchConfig.ip, openSwitchConfig.channel, openSwitchConfig.password);
    this.closeSwitch = new Switch(closeSwitchConfig.ip, closeSwitchConfig.channel, closeSwitchConfig.password);
    this.lastState = OPEN;
    this.currentState = OPEN;

    setInterval(this.updateCurrentState.bind(this), 2000);
  }

  async updateCurrentState() {
    if (await this.isOpen()) {
      this.currentState = this.lastState = OPEN;
    } else if (await this.isClosed()) {
      this.currentState = this.lastState = CLOSED;
    } else if (this.lastState === OPEN) {
      this.currentState = CLOSING
    } else if (this.lastState === CLOSING) {
      this.currentState = OPENING
    }
  }

  async isOpen() {return await this.openSwitch.isActive()}

  async isClosed() {return await this.closeSwitch.isActive()}

  async open() {
    await this.sendCommand(1);
  }

  async close() {
    await this.sendCommand(1);
  }

  setState(targetState) {
    switch (targetState) {
      case OPEN:
        this.open();
        break;
      case CLOSED:
        this.close();
        break;
    }
  }
}

let GarageDoorAcc = new GarageDoor(options.ip, options.password, options.channel, options.openSwitch, options.closeSwitch);
let GarageDoorUUID = uuid.generate('hap-nodejs:accessories:'+ options.name);
let garageDoor = exports.accessory = new Accessory(options.name, GarageDoorUUID);

// Add properties for publishing (in case we're using Core.js and not BridgedCore.js)
garageDoor.username = "2A:2B:3D:4D:2E:A1";
garageDoor.pincode = "031-45-155";

// set some basic properties (these values are arbitrary and setting them is optional)
garageDoor
  .getService(Service.AccessoryInformation)
  .setCharacteristic(Characteristic.Manufacturer, "SH")
  .setCharacteristic(Characteristic.Model, options.moduleName)
  .setCharacteristic(Characteristic.SerialNumber, "A1S2NASF88EH");

// listen for the "identify" event for this Accessory
garageDoor.on('identify', function(paired, callback) {
  //console.log("Identify", name);
  callback();
});

garageDoor
  .addService(Service.GarageDoorOpener, options.name)
  .getCharacteristic(Characteristic.CurrentDoorState)
  .on('get', function(callback) {
     GarageDoorAcc.updateCurrentState();
     callback(null, Boolean(GarageDoorAcc.currentState));
});

garageDoor
  .getService(Service.GarageDoorOpener, options.name)
  .getCharacteristic(Characteristic.TargetDoorState)
  .on('set', function(value, callback) {
     GarageDoorAcc.setState(value);
     callback();
});

garageDoor
  .getService(Service.GarageDoorOpener, options.name)
  .getCharacteristic(Characteristic.ObstructionDetected)
  .on('get', function(callback) {
     callback(null, false);
});
