const {
  BaseKonnector,
  saveFiles,
  log,
  cozyClient
} = require('cozy-konnector-libs')
const soap = require('soap')
const Readable = require('stream').Readable

const baseWSDL = 'https://www.silaexpert01.fr/Silae/SWS/SWS.asmx?WSDL'
const basePath = '/Silae/SWS/SWS.asmx'

module.exports = new BaseKonnector(start)

async function start(fields, cozyParameters) {
  log('info', 'Authenticating ...')
  if (cozyParameters) log('debug', 'Found COZY_PARAMETERS')

  const loginInfo = await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of documents')
  const documentList = await getDocumentList(loginInfo)

  log('info', 'Saving data to Cozy')
  await savingDocuments(documentList, loginInfo, fields)
}

function authenticate(username, password) {
  let loginInfo = {}
  log('debug', 'Getting WSDL from ' + baseWSDL)
  return new Promise(resolve =>
    soap.createClient(baseWSDL, function(err, client) {
      log('info', 'Client successfully created')
      client.SWS_SiteLoginEx(
        {
          SWSLogin: '',
          SWSPassword: '',
          USRLogin: username,
          USRPassword: password
        },
        function(err, result) {
          resolve(result)
        }
      )
    })
  )
    .then(result => {
      const adresseFermeDistante =
        result.SWS_SiteLoginExResult.AdresseFermeDistante
      log('debug', 'Using AdresseFermeDistante ' + adresseFermeDistante)
      return new Promise(resolve =>
        soap.createClient(baseWSDL, (err, client) => {
          client.setEndpoint('https://' + adresseFermeDistante + basePath)
          client.SWS_SiteLoginEx(
            {
              SWSLogin: '',
              SWSPassword: '',
              USRLogin: username,
              USRPassword: password
            },
            function(err, result) {
              resolve(result)
            }
          )
        })
      )
    })
    .then(result => {
      loginInfo.repartiteurAdresse =
        result.SWS_SiteLoginExResult.RepartiteurAdresse
      log('debug', 'Using RepartiteurAdresse ' + loginInfo.repartiteurAdresse)
      return new Promise(resolve =>
        soap.createClient(baseWSDL, (err, client) => {
          client.setEndpoint(
            'https://' + loginInfo.repartiteurAdresse + basePath
          )
          client.SWS_SiteLoginEx(
            {
              SWSLogin: '',
              SWSPassword: '',
              USRLogin: username,
              USRPassword: password
            },
            function(err, result) {
              resolve(result)
            }
          )
        })
      )
    })
    .then(result => {
      loginInfo.token = result.SWS_SiteLoginExResult.Token
      loginInfo.id_domaine =
        result.SWS_SiteLoginExResult.ListeOnglets.SWS_InformationsOnglet[0].ID_DOMAINE
      loginInfo.id_paisalarie =
        result.SWS_SiteLoginExResult.ListeOnglets.SWS_InformationsOnglet[0].ID_PAISALARIE
      log('debug', 'Token ' + loginInfo.token)
      log('debug', 'ID_DOMAINE ' + loginInfo.id_domaine)
      log('debug', 'ID_PAISALARIE ' + loginInfo.id_paisalarie)
      return loginInfo
    })
    .catch(error => log('error', error))
}

function getDocumentList(loginInfo) {
  return new Promise(resolve =>
    soap.createClient(baseWSDL, function(err, client) {
      client.setEndpoint('https://' + loginInfo.repartiteurAdresse + basePath)
      client.SWS_UtilisateurSalarieListeBulletins(
        {
          Token: loginInfo.token,
          ID_DOMAINE: loginInfo.id_domaine,
          ID_PAISALARIE: loginInfo.id_paisalarie
        },
        function(err, result) {
          resolve(
            result.SWS_UtilisateurSalarieListeBulletinsResult.Elements
              .CPAISWSUtilisateurSalarieListeBulletinsElement
          )
        }
      )
    })
  )
    .then(result => {
      log('debug', result)
      return result
    })
    .catch(error => log('error', error))
}

function savingDocuments(documentList, loginInfo, fields) {
  return Promise.all(
    documentList.map(document =>
      new Promise(resolve =>
        soap.createClient(baseWSDL, function(err, client) {
          client.setEndpoint(
            'https://' + loginInfo.repartiteurAdresse + basePath
          )
          client.SWS_UtilisateurSalarieRecupererImage(
            {
              Token: loginInfo.token,
              ID_DOMAINE: loginInfo.id_domaine,
              ID_PAISALARIE: loginInfo.id_paisalarie,
              NatureImage: 1,
              ID_IMAGE: document.ID_PAIBULLETIN
              // document.BUL_Periode : Date bulletin
            },
            function(err, result) {
              console.log(result)
              // const s = new Readable()
              // s._read = () => {} // redundant? see update below
              // s.push(result.SWS_UtilisateurSalarieRecupererImageResult.Image)
              // s.push(null)
              // cozyClient.files.create(s, { name: 'test.pdf' })
              saveFiles([
                {
                  filestream:
                    result.SWS_UtilisateurSalarieRecupererImageResult.Image,
                  filename: 'test.pdf'
                },
                fields
              ])
              resolve(result)
            }
          )
        })
      )
        // .then(result => {
        //   log('debug', result)
        //   console.log(fields)
        // })
        .catch(error => log('error', error))
    )
  )
}
