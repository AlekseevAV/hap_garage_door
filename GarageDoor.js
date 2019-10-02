let Accessory = require('../').Accessory;
let Service = require('../').Service;
let Characteristic = require('../').Characteristic;
let uuid = require('../').uuid;
const axios = require('axios');

// Настроки для работы с концевиками
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
    password: 'sec',
    // Интервал обновления состояния ворот в милисекундах
    updateTimeout: 2000,
    // Время в милисекундах, на которое откладывается обновление состояния после последней команды
    delayUpdateAfterLastCommand: 5000
  }
};

// Пример настроек для работы без концевиков
// let options = {
//   name: 'Гаражные ворота',
//   moduleName: 'GarageDoor',
//   door: {
//     ip: '192.168.0.91',
//     channel: '4',
//     password: 'sec',
//     // Интервал обновления состояния ворот в милисекундах
//     updateTimeout: 2000,
//     // Время в милисекундах, на которое откладывается обновление состояния после последней команды
//     delayUpdateAfterLastCommand: 5000,
//     // Время полного открытия/закрытия ворот в милисекундах
//     openCloseTimeout: 5000
//   }
// };


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
  constructor (garageDoorHK, options) {
    super(options.door.ip, options.door.password, options.door.channel);
    this.garageDoorHK = garageDoorHK;
    if (options.openSwitch) {
      this.openSwitch = new Switch(options.openSwitch.ip, options.openSwitch.password, options.openSwitch.channel);
    }
    if (options.closeSwitch) {
      this.closeSwitch = new Switch(options.closeSwitch.ip, options.closeSwitch.password, options.closeSwitch.channel);
    }
    this.lastState = null;
    this.currentState = OPEN;
    this.lastCommandTime = new Date();
    this.delayUpdateAfterLastCommand = options.door.delayUpdateAfterLastCommand || 5000;

    setInterval(this.updateCurrentState.bind(this), options.door.updateTimeout);
  }

  async updateCurrentState() {
    const waitAfterLastCommand = (new Date - this.lastCommandTime) < this.delayUpdateAfterLastCommand;
    if (await this.isOpen() && (waitAfterLastCommand === false)) {
      this.currentState = this.lastState = OPEN;
      this.garageDoorHK.getService(Service.GarageDoorOpener).setCharacteristic(Characteristic.CurrentDoorState, OPEN);
      this.garageDoorHK.getService(Service.GarageDoorOpener).updateCharacteristic(Characteristic.TargetDoorState, OPEN);
    } else if (await this.isClosed() && (waitAfterLastCommand === false)) {
      this.currentState = this.lastState = CLOSED;
      this.garageDoorHK.getService(Service.GarageDoorOpener).setCharacteristic(Characteristic.CurrentDoorState, CLOSED);
      this.garageDoorHK.getService(Service.GarageDoorOpener).updateCharacteristic(Characteristic.TargetDoorState, CLOSED);
    } else if (this.lastState === OPEN) {
      this.currentState = CLOSING;
      this.garageDoorHK.getService(Service.GarageDoorOpener).setCharacteristic(Characteristic.CurrentDoorState, CLOSING);
      this.garageDoorHK.getService(Service.GarageDoorOpener).updateCharacteristic(Characteristic.TargetDoorState, CLOSED);
    } else if (this.lastState === CLOSED) {
      this.currentState = OPENING;
      this.garageDoorHK.getService(Service.GarageDoorOpener).setCharacteristic(Characteristic.CurrentDoorState, OPENING);
      this.garageDoorHK.getService(Service.GarageDoorOpener).updateCharacteristic(Characteristic.TargetDoorState, OPEN);
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
    this.lastCommandTime = new Date();
  }
}

class GarageDoorWithoutSwitch extends GarageDoor {
  constructor (garageDoorHK, options) {
    super(garageDoorHK, options);
    this.openCloseTimeout = options.door.openCloseTimeout;
    this.lastCommand = null;
  }

  isDoorShouldSwitchState() {
    return (new Date - this.lastCommandTime) > this.openCloseTimeout
  }

  async isOpen() {
    return this.lastCommand === OPEN && this.isDoorShouldSwitchState()
  }

  async isClosed() {
    return this.lastCommand === CLOSED && this.isDoorShouldSwitchState()
  }

  setState(targetState) {
    super.setState(targetState);
    this.lastCommand = targetState;
  }
}

let GarageDoorUUID = uuid.generate('hap-nodejs:accessories:'+ options.name);
let garageDoor = exports.accessory = new Accessory(options.name, GarageDoorUUID);
let GarageDoorAcc = null;

if (options.openSwitch && options.closeSwitch) {
  GarageDoorAcc = new GarageDoor(garageDoor, options);
} else if (options.door.openCloseTimeout) {
  GarageDoorAcc = new GarageDoorWithoutSwitch(garageDoor, options);
} else {
  throw Error('You should provide both openSwitchConfig or closeSwitchConfig or set openCloseTimeout in options')
}

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
