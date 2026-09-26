use std::collections::BTreeMap;
use std::fmt::Display;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use openmls::credentials::{BasicCredential, CredentialWithKey};
use openmls::framing::{MlsMessageBodyIn, MlsMessageIn, ProcessedMessageContent};
use openmls::group::{GroupId, MlsGroup, MlsGroupJoinConfig, StagedWelcome};
use openmls::key_packages::{KeyPackage, KeyPackageIn};
use openmls::prelude::{LeafNodeIndex, ProtocolVersion, SignatureScheme};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::{
    crypto::OpenMlsCrypto,
    signatures::Signer,
    types::{Ciphersuite, HpkeCiphertext},
    OpenMlsProvider,
};
use serde::{Deserialize, Serialize};
use tls_codec::{Deserialize as _, DeserializeBytes as _, Serialize as _};
use wasm_bindgen::prelude::*;

const SNAPSHOT_VERSION: u32 = 1;
const CIPHERSUITE: Ciphersuite =
    Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

fn js_error(error: impl Display) -> JsError {
    JsError::new(&error.to_string())
}

fn binding_error(message: &str) -> JsError {
    JsError::new(message)
}

fn message_bytes(message: &openmls::framing::MlsMessageOut) -> Result<Vec<u8>, JsError> {
    message.to_bytes().map_err(js_error)
}

#[derive(Serialize, Deserialize)]
struct ClientSnapshot {
    version: u32,
    crypto_device_id: String,
    mls_signing_public_key: Vec<u8>,
    content_signing_public_key: Vec<u8>,
    storage: BTreeMap<String, String>,
}

#[wasm_bindgen]
pub struct ShawtieMlsTransition {
    state: Vec<u8>,
    group_id: Vec<u8>,
    epoch: u64,
    control_message: Option<Vec<u8>>,
    welcome: Option<Vec<u8>>,
    application_message: Option<Vec<u8>>,
}

#[wasm_bindgen]
impl ShawtieMlsTransition {
    pub fn state(&self) -> Vec<u8> {
        self.state.clone()
    }

    pub fn group_id(&self) -> Vec<u8> {
        self.group_id.clone()
    }

    pub fn epoch(&self) -> u64 {
        self.epoch
    }

    pub fn control_message(&self) -> Option<Vec<u8>> {
        self.control_message.clone()
    }

    pub fn welcome(&self) -> Option<Vec<u8>> {
        self.welcome.clone()
    }

    pub fn application_message(&self) -> Option<Vec<u8>> {
        self.application_message.clone()
    }
}

#[wasm_bindgen]
pub struct ShawtieHpkeKeyPair {
    private_key: Vec<u8>,
    public_key: Vec<u8>,
}

#[wasm_bindgen]
impl ShawtieHpkeKeyPair {
    pub fn private_key(&self) -> Vec<u8> {
        self.private_key.clone()
    }

    pub fn public_key(&self) -> Vec<u8> {
        self.public_key.clone()
    }
}

#[wasm_bindgen]
pub struct ShawtieHpkeCiphertext {
    encapsulation: Vec<u8>,
    ciphertext: Vec<u8>,
}

#[wasm_bindgen]
impl ShawtieHpkeCiphertext {
    pub fn encapsulation(&self) -> Vec<u8> {
        self.encapsulation.clone()
    }

    pub fn ciphertext(&self) -> Vec<u8> {
        self.ciphertext.clone()
    }
}

#[wasm_bindgen]
pub struct ShawtieMlsClient {
    provider: OpenMlsRustCrypto,
    crypto_device_id: String,
    mls_signing_public_key: Vec<u8>,
    content_signing_public_key: Vec<u8>,
}

impl ShawtieMlsClient {
    fn new_signer(provider: &OpenMlsRustCrypto) -> Result<SignatureKeyPair, JsError> {
        let signer = SignatureKeyPair::new(SignatureScheme::ED25519).map_err(js_error)?;
        signer.store(provider.storage()).map_err(js_error)?;
        Ok(signer)
    }

    fn signer(&self) -> Result<SignatureKeyPair, JsError> {
        SignatureKeyPair::read(
            self.provider.storage(),
            &self.mls_signing_public_key,
            SignatureScheme::ED25519,
        )
        .ok_or_else(|| binding_error("Missing MLS signing key"))
    }

    fn content_signer(&self) -> Result<SignatureKeyPair, JsError> {
        SignatureKeyPair::read(
            self.provider.storage(),
            &self.content_signing_public_key,
            SignatureScheme::ED25519,
        )
        .ok_or_else(|| binding_error("Missing content signing key"))
    }

    fn credential_with_key(&self) -> CredentialWithKey {
        CredentialWithKey {
            credential: BasicCredential::new(self.crypto_device_id.as_bytes().to_vec()).into(),
            signature_key: self.mls_signing_public_key.clone().into(),
        }
    }

    fn storage_snapshot(&self) -> Result<BTreeMap<String, String>, JsError> {
        let values = self
            .provider
            .storage()
            .values
            .read()
            .map_err(|_| binding_error("OpenMLS storage lock poisoned"))?;
        Ok(values
            .iter()
            .map(|(key, value)| (URL_SAFE_NO_PAD.encode(key), URL_SAFE_NO_PAD.encode(value)))
            .collect())
    }

    fn snapshot_bytes(&self) -> Result<Vec<u8>, JsError> {
        serde_json::to_vec(&ClientSnapshot {
            version: SNAPSHOT_VERSION,
            crypto_device_id: self.crypto_device_id.clone(),
            mls_signing_public_key: self.mls_signing_public_key.clone(),
            content_signing_public_key: self.content_signing_public_key.clone(),
            storage: self.storage_snapshot()?,
        })
        .map_err(js_error)
    }

    fn clone_candidate(&self) -> Result<Self, JsError> {
        Self::from_snapshot(&self.snapshot_bytes()?)
    }

    fn from_snapshot(bytes: &[u8]) -> Result<Self, JsError> {
        let snapshot: ClientSnapshot = serde_json::from_slice(bytes).map_err(js_error)?;
        if snapshot.version != SNAPSHOT_VERSION {
            return Err(binding_error("Unsupported OpenMLS snapshot version"));
        }

        let provider = OpenMlsRustCrypto::default();
        {
            let mut values = provider
                .storage()
                .values
                .write()
                .map_err(|_| binding_error("OpenMLS storage lock poisoned"))?;
            for (key, value) in snapshot.storage {
                values.insert(
                    URL_SAFE_NO_PAD.decode(key).map_err(js_error)?,
                    URL_SAFE_NO_PAD.decode(value).map_err(js_error)?,
                );
            }
        }

        let client = Self {
            provider,
            crypto_device_id: snapshot.crypto_device_id,
            mls_signing_public_key: snapshot.mls_signing_public_key,
            content_signing_public_key: snapshot.content_signing_public_key,
        };
        client.signer()?;
        client.content_signer()?;
        Ok(client)
    }

    fn load_group(&self, group_id: &[u8]) -> Result<MlsGroup, JsError> {
        MlsGroup::load(self.provider.storage(), &GroupId::from_slice(group_id))
            .map_err(js_error)?
            .ok_or_else(|| binding_error("CRYPTO_GROUP_NOT_READY"))
    }

    fn transition(
        &self,
        group: &MlsGroup,
        control_message: Option<Vec<u8>>,
        welcome: Option<Vec<u8>>,
        application_message: Option<Vec<u8>>,
    ) -> Result<ShawtieMlsTransition, JsError> {
        Ok(ShawtieMlsTransition {
            state: self.snapshot_bytes()?,
            group_id: group.group_id().as_slice().to_vec(),
            epoch: group.epoch().as_u64(),
            control_message,
            welcome,
            application_message,
        })
    }
}

#[wasm_bindgen]
impl ShawtieMlsClient {
    #[wasm_bindgen(constructor)]
    pub fn new(crypto_device_id: String) -> Result<ShawtieMlsClient, JsError> {
        if crypto_device_id.is_empty() {
            return Err(binding_error("crypto device id must not be empty"));
        }
        let provider = OpenMlsRustCrypto::default();
        let mls_signer = Self::new_signer(&provider)?;
        let content_signer = Self::new_signer(&provider)?;

        Ok(Self {
            provider,
            crypto_device_id,
            mls_signing_public_key: mls_signer.to_public_vec(),
            content_signing_public_key: content_signer.to_public_vec(),
        })
    }

    #[wasm_bindgen(js_name = import_state)]
    pub fn import_state(state: &[u8]) -> Result<ShawtieMlsClient, JsError> {
        Self::from_snapshot(state)
    }

    pub fn crypto_device_id(&self) -> String {
        self.crypto_device_id.clone()
    }

    pub fn mls_signing_public_key(&self) -> Vec<u8> {
        self.mls_signing_public_key.clone()
    }

    pub fn content_signing_public_key(&self) -> Vec<u8> {
        self.content_signing_public_key.clone()
    }

    pub fn export_state(&self) -> Result<Vec<u8>, JsError> {
        self.snapshot_bytes()
    }

    pub fn key_package(&self) -> Result<Vec<u8>, JsError> {
        let signer = self.signer()?;
        let package = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &signer,
                self.credential_with_key(),
            )
            .map_err(js_error)?
            .key_package()
            .clone();
        package.tls_serialize_detached().map_err(js_error)
    }

    pub fn create_group(&self, group_id: &[u8]) -> Result<ShawtieMlsTransition, JsError> {
        if group_id.is_empty() {
            return Err(binding_error("group id must not be empty"));
        }
        let candidate = self.clone_candidate()?;
        let signer = candidate.signer()?;
        let group = MlsGroup::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .with_group_id(GroupId::from_slice(group_id))
            .build(
                &candidate.provider,
                &signer,
                candidate.credential_with_key(),
            )
            .map_err(js_error)?;
        candidate.transition(&group, None, None, None)
    }

    pub fn add_member(
        &self,
        group_id: &[u8],
        key_package: &[u8],
    ) -> Result<ShawtieMlsTransition, JsError> {
        let candidate = self.clone_candidate()?;
        let signer = candidate.signer()?;
        let mut group = candidate.load_group(group_id)?;
        let package_in = KeyPackageIn::tls_deserialize_exact(key_package.to_vec()).map_err(js_error)?;
        let package = package_in
            .validate(candidate.provider.crypto(), ProtocolVersion::Mls10)
            .map_err(js_error)?;
        if package.ciphersuite() != CIPHERSUITE {
            return Err(binding_error("CRYPTO_UNSUPPORTED_CIPHERSUITE"));
        }

        let (commit, welcome, _) = group
            .add_members(&candidate.provider, &signer, &[package])
            .map_err(js_error)?;
        group
            .merge_pending_commit(&candidate.provider)
            .map_err(js_error)?;

        candidate.transition(
            &group,
            Some(message_bytes(&commit)?),
            Some(message_bytes(&welcome)?),
            None,
        )
    }

    pub fn remove_member(
        &self,
        group_id: &[u8],
        leaf_index: u32,
    ) -> Result<ShawtieMlsTransition, JsError> {
        let candidate = self.clone_candidate()?;
        let signer = candidate.signer()?;
        let mut group = candidate.load_group(group_id)?;
        let (commit, welcome, _) = group
            .remove_members(
                &candidate.provider,
                &signer,
                &[LeafNodeIndex::new(leaf_index)],
            )
            .map_err(js_error)?;
        group
            .merge_pending_commit(&candidate.provider)
            .map_err(js_error)?;

        candidate.transition(
            &group,
            Some(message_bytes(&commit)?),
            welcome.as_ref().map(message_bytes).transpose()?,
            None,
        )
    }

    pub fn join_welcome(&self, welcome: &[u8]) -> Result<ShawtieMlsTransition, JsError> {
        let candidate = self.clone_candidate()?;
        let message = MlsMessageIn::tls_deserialize_exact(welcome.to_vec()).map_err(js_error)?;
        let welcome = match message.extract() {
            MlsMessageBodyIn::Welcome(value) => value,
            _ => return Err(binding_error("Expected MLS Welcome")),
        };
        let config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .build();
        let group = StagedWelcome::new_from_welcome(
            &candidate.provider,
            &config,
            welcome,
            None,
        )
        .map_err(js_error)?
        .into_group(&candidate.provider)
        .map_err(js_error)?;

        candidate.transition(&group, None, None, None)
    }

    pub fn member_leaf_index(
        &self,
        group_id: &[u8],
        crypto_device_id: String,
    ) -> Result<Option<u32>, JsError> {
        let group = self.load_group(group_id)?;
        let credential: openmls::credentials::Credential =
            BasicCredential::new(crypto_device_id.as_bytes().to_vec()).into();
        Ok(group.member_leaf_index(&credential).map(|index| index.u32()))
    }

    pub fn create_application_message(
        &self,
        group_id: &[u8],
        plaintext: &[u8],
    ) -> Result<ShawtieMlsTransition, JsError> {
        let candidate = self.clone_candidate()?;
        let signer = candidate.signer()?;
        let mut group = candidate.load_group(group_id)?;
        let message = group
            .create_message(&candidate.provider, &signer, plaintext)
            .map_err(js_error)?;

        candidate.transition(
            &group,
            None,
            None,
            Some(message_bytes(&message)?),
        )
    }

    pub fn process_message(
        &self,
        group_id: &[u8],
        message: &[u8],
    ) -> Result<ShawtieMlsTransition, JsError> {
        let candidate = self.clone_candidate()?;
        let mut group = candidate.load_group(group_id)?;
        let message = MlsMessageIn::tls_deserialize_exact(message.to_vec()).map_err(js_error)?;
        let processed = match message.extract() {
            MlsMessageBodyIn::PublicMessage(value) => group
                .process_message(&candidate.provider, value)
                .map_err(js_error)?,
            MlsMessageBodyIn::PrivateMessage(value) => group
                .process_message(&candidate.provider, value)
                .map_err(js_error)?,
            _ => return Err(binding_error("Expected MLS protocol message")),
        };

        let mut application_message = None;
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(value) => {
                application_message = Some(value.into_bytes());
            }
            ProcessedMessageContent::ProposalMessage(value)
            | ProcessedMessageContent::ExternalJoinProposalMessage(value) => {
                group
                    .store_pending_proposal(candidate.provider.storage(), *value)
                    .map_err(js_error)?;
            }
            ProcessedMessageContent::StagedCommitMessage(value) => {
                group
                    .merge_staged_commit(&candidate.provider, *value)
                    .map_err(js_error)?;
            }
            ProcessedMessageContent::OwnPendingCommit => {
                group
                    .merge_pending_commit(&candidate.provider)
                    .map_err(js_error)?;
            }
            ProcessedMessageContent::OwnPrivateMessage => {}
            _ => return Err(binding_error("Unsupported MLS application content")),
        }

        candidate.transition(&group, None, None, application_message)
    }

    pub fn sign_content(&self, payload: &[u8]) -> Result<Vec<u8>, JsError> {
        self.content_signer()?.sign(payload).map_err(js_error)
    }

    pub fn verify_content(
        &self,
        public_key: &[u8],
        payload: &[u8],
        signature: &[u8],
    ) -> bool {
        self.provider
            .crypto()
            .verify_signature(SignatureScheme::ED25519, payload, public_key, signature)
            .is_ok()
    }

    pub fn derive_recovery_key_pair(
        &self,
        ikm: &[u8],
    ) -> Result<ShawtieHpkeKeyPair, JsError> {
        if ikm.len() < 32 {
            return Err(binding_error("Recovery IKM must be at least 32 bytes"));
        }
        let pair = self
            .provider
            .crypto()
            .derive_hpke_keypair(CIPHERSUITE.hpke_config(), ikm)
            .map_err(js_error)?;
        Ok(ShawtieHpkeKeyPair {
            private_key: pair.private.to_vec(),
            public_key: pair.public,
        })
    }

    pub fn hpke_seal(
        &self,
        public_key: &[u8],
        info: &[u8],
        aad: &[u8],
        plaintext: &[u8],
    ) -> Result<ShawtieHpkeCiphertext, JsError> {
        let ciphertext = self
            .provider
            .crypto()
            .hpke_seal(
                CIPHERSUITE.hpke_config(),
                public_key,
                info,
                aad,
                plaintext,
            )
            .map_err(js_error)?;
        Ok(ShawtieHpkeCiphertext {
            encapsulation: ciphertext.kem_output.to_vec(),
            ciphertext: ciphertext.ciphertext.to_vec(),
        })
    }

    pub fn hpke_open(
        &self,
        private_key: &[u8],
        info: &[u8],
        aad: &[u8],
        encapsulation: &[u8],
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        self.provider
            .crypto()
            .hpke_open(
                CIPHERSUITE.hpke_config(),
                &HpkeCiphertext {
                    kem_output: encapsulation.to_vec().into(),
                    ciphertext: ciphertext.to_vec().into(),
                },
                private_key,
                info,
                aad,
            )
            .map_err(js_error)
    }
}
