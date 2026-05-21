// Copyright (c) 2023, Circle Technologies, LLC. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Installed by `npm install node-forge`
const forge = require('node-forge');

// Paste your entity public key here.
const publicKeyString = `-----BEGIN PUBLIC KEY-----\nMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAyNiqj9RftFMMf0yR/35H\nw/RpZly4/zl0dOChCKOQJp/ZbIMW1XdlDo/AN8L8P5NlqIJOYJQV2guDnHGnGH97\ngw6ePu6kEdStq0b4CJy49VVtrHCXA7Kg3N+60DuXJMRWDTj3lJz6GWHnf06/4XaK\nt4ep0p0/mEM1faxlvmGwksjIrqBS6s72/J893Rb7W4bh7XxHE2H92oCHLRZTRwuA\n24rlWo2WNt8J456nwg3X8YuP4Wn2HcP5hZqNdZft2vWkeX1/PDnpyQuttPrK1r/Q\n1gKPyb8/4SOjk4K9Kdma1PhxsOoXOfO4n6Fe2pi7Sr9iQbNGnIM4WP+ldKqsuh6p\n7nFxisH2ErMJRkEzaxsD4ujk5FSuKBhpCM/V5NHvAgl9LBoCUIZxURLXtOpDtnUA\nwLPiLwfNtsuvlpZE26W1Af3872414mWxfES4Z7nrsRfWltBNQKbdHIkNwVh7K5BO\n9vFQhD1/XRio2FtDaNVteqz18s0DoVgPOCpZdklO0iRBaWnzala0ooZC/ATaSVb0\nNtHh8DwRxPlAO7SNR3ZpLmDHMJ0mtHej1Q8AWV1xx+cWW6xgG6Jj17536aKu8Ug1\nhcjwnF60xKQ4ljPJBYL9gw0PHChKmbqWd1ysgyH5eJynvfhwg/RcslYkiMNPoGNQ\nmydw36zueOJpBU9KQ9x+tEsCAwEAAQ==\n-----END PUBLIC KEY-----\n`

// If you already have a hex encoded entity secret, you can paste it here. the length of the hex string should be 64.
const hexEncodedEntitySecret = "1cb30fb5c39b8b99ee7029218898101eb8a199b2ce1f4b03f2c5d66cbb562968"

// The following sample codes generate a distinct entity secret ciphertext with each execution
function main() {
    const entitySecret = forge.util.hexToBytes(hexEncodedEntitySecret);
    if (entitySecret.length != 32) {
        console.log("invalid entity secret");
        return;
    }

    // encrypt data by the public key
    const publicKey = forge.pki.publicKeyFromPem(publicKeyString);
    const encryptedData = publicKey.encrypt(entitySecret, "RSA-OAEP", {
        md: forge.md.sha256.create(),
        mgf1: {
            md: forge.md.sha256.create()
        }
    });

    // encode to base64
    const base64EncryptedData = forge.util.encode64(encryptedData);

    console.log('Hex encoded entity secret: ', hexEncodedEntitySecret);
    console.log('Entity secret ciphertext: ', base64EncryptedData);
}

if (require.main === module) {
    main();
}