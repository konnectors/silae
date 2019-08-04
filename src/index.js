const { BaseKonnector, saveBills, log } = require('cozy-konnector-libs')
const soap = require('soap')

const baseWSDL = 'https://www.silaexpert01.fr/Silae/SWS/SWS.asmx?WSDL'
const basePath = '/Silae/SWS/SWS.asmx'
let repartiteurAdresse, token, id_domaine, id_paisalarie

module.exports = new BaseKonnector(start)

async function start(fields, cozyParameters) {
  log('info', 'Authenticating ...')
  if (cozyParameters) log('debug', 'Found COZY_PARAMETERS')

  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of documents')
  const documentList = await getDocumentList()

  log('info', 'Downloading documents')
  await savingDocuments(documentList)

  // Here we use the saveBills function even if what we fetch are not bills,
  // but this is the most common case in connectors
  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields, {
    // This is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['books']
  })
}

function authenticate(username, password) {
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
      repartiteurAdresse = result.SWS_SiteLoginExResult.RepartiteurAdresse
      log('debug', 'Using RepartiteurAdresse ' + repartiteurAdresse)
      return new Promise(resolve =>
        soap.createClient(baseWSDL, (err, client) => {
          client.setEndpoint('https://' + repartiteurAdresse + basePath)
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
      token = result.SWS_SiteLoginExResult.Token
      id_domaine =
        result.SWS_SiteLoginExResult.ListeOnglets.SWS_InformationsOnglet[0]
          .ID_DOMAINE
      id_paisalarie =
        result.SWS_SiteLoginExResult.ListeOnglets.SWS_InformationsOnglet[0]
          .ID_PAISALARIE
      log('debug', 'Token ' + token)
      log('debug', 'ID_DOMAINE ' + id_domaine)
      log('debug', 'ID_PAISALARIE ' + id_paisalarie)
    })
    .catch(error => log('error', error))
}

function getDocumentList() {
  return new Promise(resolve =>
    soap.createClient(baseWSDL, function(err, client) {
      client.setEndpoint('https://' + repartiteurAdresse + basePath)
      client.SWS_UtilisateurSalarieListeBulletins(
        {
          Token: token,
          ID_DOMAINE: id_domaine,
          ID_PAISALARIE: id_paisalarie
        },
        function(err, result) {
          console.log(result)
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
