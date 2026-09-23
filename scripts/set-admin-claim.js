// scripts/set-admin-claim.js
//
// Script local (NO se deploya) para dar o quitar permisos de administrador a
// una cuenta de Firebase Auth mediante el custom claim { admin: true }.
// firestore.rules y storage.rules usan ese claim para autorizar escrituras.
//
// Uso:
//   1. Firebase Console > Configuración del proyecto > Cuentas de servicio
//      > Generar nueva clave privada. Guardala como scripts/service-account.json
//      (está en .gitignore).
//   2. cd scripts && npm install
//   3. npm run set-admin -- <email-o-uid>            (otorga admin)
//      npm run set-admin -- <email-o-uid> --remove   (revoca admin)

const path = require('path');
const admin = require('firebase-admin');

const [target, flag] = process.argv.slice(2);
if (!target) {
  console.error('Uso: node set-admin-claim.js <email-o-uid> [--remove]');
  process.exit(1);
}
const grant = flag !== '--remove';

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, 'service-account.json'))),
});

async function main() {
  const auth = admin.auth();
  const user = target.includes('@') ? await auth.getUserByEmail(target) : await auth.getUser(target);

  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: grant });

  console.log(`✅ ${user.email || user.uid}: admin=${grant}`);
  console.log('   El usuario debe cerrar sesión y volver a entrar para refrescar el token.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
