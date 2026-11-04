import {registrationReader} from '../g40/registration.mjs';const r=await registrationReader()();console.log(JSON.stringify(r,null,2));
