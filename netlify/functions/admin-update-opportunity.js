const { routeApi } = require("./lib/api-router");
exports.handler = (event) => routeApi(event, "admin-update-opportunity");
