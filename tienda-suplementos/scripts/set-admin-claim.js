// scripts/set-admin-claim.js
//
// Script de uso único (no se deploya, se corre a mano desde tu compu) para
// marcar una cuenta de Firebase Auth como administradora. Las nuevas
// firestore.rules usan esto (request.auth.token.admin == true) para decidir
// quién puede gestionar productos y pedidos — un email hardcodeado sería
// fácil de eludir, un custom claim en el token no.
//
// Uso:
//   1. Firebase Console > Configuración del proyecto > Cuentas de servicio
//      > Generar nueva clave privada. Guardá el JSON como
//      scripts/service-account.json (está en .gitignore, no se sube a git).
//   2. cd scripts && npm install
//   3. node set-admin-claim.js <uid-del-usuario-admin>
//      (el uid lo ves en Firebase Console > Authentication > Users)

const admin = require('firebase-admin');
const path = require('path');

const uid = process.argv[2];
if (!uid) {
  console.error('Uso: node set-admin-claim.js <uid>');
  process.exit(1);
}

const serviceAccountPath = path.join(__dirname, 'service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

admin
  .auth()
  .setCustomUserClaims(uid, { admin: true })
  .then(() => {
    console.log(`✅ Listo: el usuario ${uid} ahora tiene el claim admin:true.`);
    console.log('   Tiene que cerrar sesión y volver a entrar para que el token se actualice.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error al asignar el claim:', err);
    process.exit(1);
  });
