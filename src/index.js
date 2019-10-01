process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://699e0e989af94c5faf8fb83096b6e896@sentry.cozycloud.cc/129'

/* eslint-disable require-atomic-updates */
const { BaseKonnector, saveFiles, log } = require('cozy-konnector-libs')
const soap = require('soap')

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
  await savingDocuments(documentList, loginInfo, fields, this._account._id )
}

async function authenticate(username, password) {
  let loginInfo = {}
  log('debug', 'Getting WSDL from ' + baseWSDL)

  try {
    const siteLoginClient = await new Promise((resolve, reject) =>
      soap.createClient(baseWSDL, function(err, client) {
        if (err) return reject(err)
        log('info', 'Client successfully created')
        client.SWS_SiteLoginEx(
          {
            SWSLogin: '',
            SWSPassword: '',
            USRLogin: username,
            USRPassword: password
          },
          function(err, result) {
            if (err) return reject(err)
            if (result.SWS_SiteLoginExResult.Error)
              reject(result.SWS_SiteLoginExResult.Error)
            resolve(result)
          }
        )
      })
    )

    const adresseFermeDistante =
      siteLoginClient.SWS_SiteLoginExResult.AdresseFermeDistante
    log('debug', 'Using AdresseFermeDistante ' + adresseFermeDistante)

    const adresseFermeDistanteClient = await new Promise((resolve, reject) =>
      soap.createClient(baseWSDL, (err, client) => {
        if (err) return reject(err)
        client.setEndpoint('https://' + adresseFermeDistante + basePath)
        client.SWS_SiteLoginEx(
          {
            SWSLogin: '',
            SWSPassword: '',
            USRLogin: username,
            USRPassword: password
          },
          function(err, result) {
            if (err) return reject(err)
            if (result.SWS_SiteLoginExResult.Error)
              reject(result.SWS_SiteLoginExResult.Error)
            resolve(result)
          }
        )
      })
    )

    loginInfo.repartiteurAdresse =
      adresseFermeDistanteClient.SWS_SiteLoginExResult.RepartiteurAdresse
    log('debug', 'Using RepartiteurAdresse ' + loginInfo.repartiteurAdresse)

    const repartiteurAdresseClient = await new Promise((resolve, reject) =>
      soap.createClient(baseWSDL, (err, client) => {
        if (err) return reject(err)
        client.setEndpoint('https://' + loginInfo.repartiteurAdresse + basePath)
        client.SWS_SiteLoginEx(
          {
            SWSLogin: '',
            SWSPassword: '',
            USRLogin: username,
            USRPassword: password
          },
          function(err, result) {
            if (err) return reject(err)
            if (result.SWS_SiteLoginExResult.Error)
              reject(result.SWS_SiteLoginExResult.Error)
            resolve(result)
          }
        )
      })
    )

    loginInfo.token = await repartiteurAdresseClient.SWS_SiteLoginExResult.Token
    loginInfo.id_domaine = await repartiteurAdresseClient.SWS_SiteLoginExResult
      .ListeOnglets.SWS_InformationsOnglet[0].ID_DOMAINE
    loginInfo.id_paisalarie = await repartiteurAdresseClient
      .SWS_SiteLoginExResult.ListeOnglets.SWS_InformationsOnglet[0]
      .ID_PAISALARIE

    log('debug', 'Token ' + loginInfo.token)
    log('debug', 'ID_DOMAINE ' + loginInfo.id_domaine)
    log('debug', 'ID_PAISALARIE ' + loginInfo.id_paisalarie)
  } catch (error) {
    log('error', error)
  }
  return loginInfo
}

async function getDocumentList(loginInfo) {
  let documentList
  try {
    documentList = await new Promise((resolve, reject) =>
      soap.createClient(baseWSDL, function(err, client) {
        if (err) return reject(err)
        client.setEndpoint('https://' + loginInfo.repartiteurAdresse + basePath)
        client.SWS_UtilisateurSalarieListeBulletins(
          {
            Token: loginInfo.token,
            ID_DOMAINE: loginInfo.id_domaine,
            ID_PAISALARIE: loginInfo.id_paisalarie
          },
          function(err, result) {
            if (err) return reject(err)
            if (result.SWS_UtilisateurSalarieListeBulletinsResult.Error)
              reject(result.SWS_UtilisateurSalarieListeBulletinsResult.Error)
            resolve(
              result.SWS_UtilisateurSalarieListeBulletinsResult.Elements
                .CPAISWSUtilisateurSalarieListeBulletinsElement
            )
          }
        )
      })
    )
    await log('debug', documentList)
  } catch (error) {
    log('error', error)
  }
  return documentList
}

function savingDocuments(documentList, loginInfo, fields, accountId) {
  return Promise.all(
    documentList.map(document =>
      new Promise((resolve, reject) =>
        soap.createClient(baseWSDL, function(err, client) {
          if (err) return reject(err)
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
            },
            function(err, result) {
              if (err) return reject(err)
              if (result.SWS_UtilisateurSalarieRecupererImageResult.Error)
                reject(result.SWS_UtilisateurSalarieRecupererImageResult.Error)
              const binaryData = Buffer.from(
                result.SWS_UtilisateurSalarieRecupererImageResult.Image,
                'base64'
              )
              const filename =
                'bulletin_' +
                document.BUL_Periode.getFullYear() +
                '_' +
                (document.BUL_Periode.getMonth() + 1) +
                '_' +
                document.BUL_Periode.getDate() +
                '.pdf'
              saveFiles(
                [
                  {
                    filestream: binaryData,
                    filename: filename,
                    contentType: 'application/pdf'
                  }
                ],
                fields,
                {
                  sourceAccount: accountId,
                  sourceAccountIdentifier: fields.login
                }
              )
              resolve(result)
            }
          )
        })
      ).catch(error => log('error', error))
    )
  )
}
