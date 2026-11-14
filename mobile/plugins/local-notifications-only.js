// Cheer Pressure's notifications are all local (scheduled on the phone, no push server), so the
// app does not ask for the push entitlement that expo-notifications adds by itself. That also lets
// a free Apple developer account (a Personal Team) sign the app, which cannot sign push.
const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults["aps-environment"];
    return c;
  });
};
