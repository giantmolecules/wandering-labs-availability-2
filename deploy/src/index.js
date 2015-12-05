import _ from 'lodash';
import AWS from 'aws-sdk';
import fs from 'fs';
import npm from 'npm';
import os from 'os';

var exec = require('child_process').exec;

class Component {
  constructor(component) {
    this.componentName = component;
    this.settings = JSON.parse(fs.readFileSync(this.packageJson, 'utf8'))
    this.settingsShared = JSON.parse(fs.readFileSync(this.packageJsonShared, 'utf8'))
  }

  deploy() {
    let lambdas = this.settings.lambda
    _.forEach(lambdas, (params) =>{
      console.log('Deploying: ', params.functionName);
      let deploy = new Deploy(this, params);
      deploy.update();
    });
  }

  get srcDir() {
    return __dirname + '/../../' + this.componentName + '/src';
  }

  get packageJson() {
    return __dirname + '/../../' + this.componentName + '/package.json'
  }

  get packageJsonShared() {
    return __dirname + '/../../shared/package.json'
  }

  get envFilename() {
    return __dirname + '/../../.env';
  }


}

class Deploy {
  constructor(component, params) {
    this.component = component;
    this.params = params

    this.lambda = new AWS.Lambda({apiVersion: '2014-11-11'});
  }

  update() {
    this.codeDirectory = this._codeDirectory();
    this.zipFile = this._zipfileTmpPath();
    console.log('codeDirectory', this.codeDirectory);
    this._buildDist();
    this._copyPackageJson();
    this._copyEnv();
    this._npmInstall((err) => {
      console.log('_npmInstall done')
      this._zipComponent((err) => {
        console.log('zip complete', this.zipFile);
        this._lambdaUpload((err,data) => {
          console.log('lambda upload complete', err, data);
        });
      });
    });

  }


  // private

  _codeDirectory() {
    var epoch_time = +new Date();
    let codeDirectory =  os.tmpDir() + this.params.functionName + '-' + epoch_time;
    // let codeDirectory =  __dirname + '/../deploys/' + this.params.functionName; // + '-' + epoch_time;
    if (!fs.existsSync(codeDirectory)) {
      fs.mkdirSync(codeDirectory);
    }
    return codeDirectory;
  }

  _zipfileTmpPath() {
    let ms_since_epoch = +new Date();
    let filename = this.params.functionName + '-' + ms_since_epoch + '.zip';
    let zipfile = os.tmpDir() + filename;
    return zipfile;
  }

  _buildDist() {
    let execCmd = `babel ${this.component.srcDir} -d ${this.codeDirectory}`;
    console.log('babel build'); //, execCmd)
    exec(execCmd);

  }

  _copyPackageJson() {
    let newPackageJson = this.codeDirectory + '/package.json';

    if (!fs.existsSync(newPackageJson)) {
      this.component.settings.dependencies = _.merge(this.component.settings.dependencies, this.component.settingsShared.dependencies);
      fs.writeFileSync(newPackageJson, JSON.stringify(this.component.settings));
      console.log('package.json successfully created');
    }
  }

  _copyEnv() {
    let newEnv = this.codeDirectory + '/.env';

    if (!fs.existsSync(newEnv)) {
      fs.writeFileSync(newEnv, fs.readFileSync(this.component.envFilename));
      console.log('.env successfully created');
    }
  }

  _npmInstall(callback) {
    npm.load({prefix: this.codeDirectory, production: true, loglevel: 'silent'}, function (er) {
      npm.commands.install([], function (er, data) {
        if (er) {
          console.log("Error", er)
        }
        return callback(null,true);
      });
      npm.registry.log.on("log", function (message) {  });
    });
  }

  _zipComponent(callback) {
    let cmd = 'zip -r ' + this.zipFile + ' .';
    console.log('cmd', cmd)
    exec(cmd, { cwd: this.codeDirectory, maxBuffer: 50 * 1024 * 1024 }, function(err, stdout, stderr) {
      return callback(err, true);
    });
  }

  _lambdaUpload(callback) {
    var functionParams = {
      FunctionName: this.params.functionName,
      FunctionZip: fs.readFileSync(this.zipFile),
      Handler: this.params.handler,
      Mode: 'event',
      Role: process.env.AWS_IAM,
      Runtime: 'nodejs',
      Description: 'TODO',
      MemorySize: 128,
      Timeout: 30
    };

    this.lambda.uploadFunction(functionParams, function (err, data) {
      callback(err, data);
    });

  }

}


console.log('process.argv', process.env.DEPLOY)

process.env.DEPLOY.split(',').forEach(function (val, index) {
  console.log('Deploying: ' + index + ': ' + val);
  new Component(val).deploy();
});

//new Component('api').deploy();
