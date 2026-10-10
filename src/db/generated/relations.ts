import { relations } from "drizzle-orm/relations";
import { appUser, platformRole, category, attributeDefinition, attributeOption, mediaAsset, municipality, vendor, vendorSlugHistory, vendorLink, vendorMember, vendorService, vendorAttributeValue, vendorClaim, verificationRecord, collection, vendorSuggestion, activityEvent, vendorDailyStats, statusChange, auditLog, attributeDefinitionCategory, vendorServiceArea, vendorCategory, vendorMedia, collectionItem } from "./schema";

export const platformRoleRelations = relations(platformRole, ({one}) => ({
	appUser_userId: one(appUser, {
		fields: [platformRole.userId],
		references: [appUser.id],
		relationName: "platformRole_userId_appUser_id"
	}),
	appUser_grantedBy: one(appUser, {
		fields: [platformRole.grantedBy],
		references: [appUser.id],
		relationName: "platformRole_grantedBy_appUser_id"
	}),
}));

export const appUserRelations = relations(appUser, ({many}) => ({
	platformRoles_userId: many(platformRole, {
		relationName: "platformRole_userId_appUser_id"
	}),
	platformRoles_grantedBy: many(platformRole, {
		relationName: "platformRole_grantedBy_appUser_id"
	}),
	mediaAssets: many(mediaAsset),
	vendors: many(vendor),
	vendorMembers_userId: many(vendorMember, {
		relationName: "vendorMember_userId_appUser_id"
	}),
	vendorMembers_addedBy: many(vendorMember, {
		relationName: "vendorMember_addedBy_appUser_id"
	}),
	vendorClaims_claimantUserId: many(vendorClaim, {
		relationName: "vendorClaim_claimantUserId_appUser_id"
	}),
	vendorClaims_reviewedBy: many(vendorClaim, {
		relationName: "vendorClaim_reviewedBy_appUser_id"
	}),
	verificationRecords: many(verificationRecord),
	collections: many(collection),
	vendorSuggestions_suggestedBy: many(vendorSuggestion, {
		relationName: "vendorSuggestion_suggestedBy_appUser_id"
	}),
	vendorSuggestions_reviewedBy: many(vendorSuggestion, {
		relationName: "vendorSuggestion_reviewedBy_appUser_id"
	}),
	activityEvents: many(activityEvent),
	statusChanges: many(statusChange),
	auditLogs: many(auditLog),
}));

export const categoryRelations = relations(category, ({one, many}) => ({
	category: one(category, {
		fields: [category.parentId],
		references: [category.id],
		relationName: "category_parentId_category_id"
	}),
	categories: many(category, {
		relationName: "category_parentId_category_id"
	}),
	vendorSuggestions: many(vendorSuggestion),
	attributeDefinitionCategories: many(attributeDefinitionCategory),
	vendorCategories: many(vendorCategory),
}));

export const attributeOptionRelations = relations(attributeOption, ({one, many}) => ({
	attributeDefinition: one(attributeDefinition, {
		fields: [attributeOption.attributeDefinitionId],
		references: [attributeDefinition.id]
	}),
	vendorAttributeValues: many(vendorAttributeValue),
}));

export const attributeDefinitionRelations = relations(attributeDefinition, ({many}) => ({
	attributeOptions: many(attributeOption),
	vendorAttributeValues: many(vendorAttributeValue),
	attributeDefinitionCategories: many(attributeDefinitionCategory),
}));

export const mediaAssetRelations = relations(mediaAsset, ({one, many}) => ({
	appUser: one(appUser, {
		fields: [mediaAsset.uploadedBy],
		references: [appUser.id]
	}),
	verificationRecords: many(verificationRecord),
	vendorMedias: many(vendorMedia),
}));

export const vendorRelations = relations(vendor, ({one, many}) => ({
	municipality: one(municipality, {
		fields: [vendor.primaryMunicipalityId],
		references: [municipality.id]
	}),
	appUser: one(appUser, {
		fields: [vendor.createdBy],
		references: [appUser.id]
	}),
	vendorSlugHistories: many(vendorSlugHistory),
	vendorLinks: many(vendorLink),
	vendorMembers: many(vendorMember),
	vendorServices: many(vendorService),
	vendorAttributeValues: many(vendorAttributeValue),
	vendorClaims: many(vendorClaim),
	verificationRecords: many(verificationRecord),
	vendorSuggestions: many(vendorSuggestion),
	activityEvents: many(activityEvent),
	vendorDailyStats: many(vendorDailyStats),
	vendorServiceAreas: many(vendorServiceArea),
	vendorCategories: many(vendorCategory),
	vendorMedias: many(vendorMedia),
	collectionItems: many(collectionItem),
}));

export const municipalityRelations = relations(municipality, ({many}) => ({
	vendors: many(vendor),
	activityEvents: many(activityEvent),
	vendorDailyStats: many(vendorDailyStats),
	vendorServiceAreas: many(vendorServiceArea),
}));

export const vendorSlugHistoryRelations = relations(vendorSlugHistory, ({one}) => ({
	vendor: one(vendor, {
		fields: [vendorSlugHistory.vendorId],
		references: [vendor.id]
	}),
}));

export const vendorLinkRelations = relations(vendorLink, ({one}) => ({
	vendor: one(vendor, {
		fields: [vendorLink.vendorId],
		references: [vendor.id]
	}),
}));

export const vendorMemberRelations = relations(vendorMember, ({one}) => ({
	vendor: one(vendor, {
		fields: [vendorMember.vendorId],
		references: [vendor.id]
	}),
	appUser_userId: one(appUser, {
		fields: [vendorMember.userId],
		references: [appUser.id],
		relationName: "vendorMember_userId_appUser_id"
	}),
	appUser_addedBy: one(appUser, {
		fields: [vendorMember.addedBy],
		references: [appUser.id],
		relationName: "vendorMember_addedBy_appUser_id"
	}),
}));

export const vendorServiceRelations = relations(vendorService, ({one}) => ({
	vendor: one(vendor, {
		fields: [vendorService.vendorId],
		references: [vendor.id]
	}),
}));

export const vendorAttributeValueRelations = relations(vendorAttributeValue, ({one}) => ({
	vendor: one(vendor, {
		fields: [vendorAttributeValue.vendorId],
		references: [vendor.id]
	}),
	attributeDefinition: one(attributeDefinition, {
		fields: [vendorAttributeValue.attributeDefinitionId],
		references: [attributeDefinition.id]
	}),
	attributeOption: one(attributeOption, {
		fields: [vendorAttributeValue.optionId],
		references: [attributeOption.id]
	}),
}));

export const vendorClaimRelations = relations(vendorClaim, ({one}) => ({
	vendor: one(vendor, {
		fields: [vendorClaim.vendorId],
		references: [vendor.id]
	}),
	appUser_claimantUserId: one(appUser, {
		fields: [vendorClaim.claimantUserId],
		references: [appUser.id],
		relationName: "vendorClaim_claimantUserId_appUser_id"
	}),
	appUser_reviewedBy: one(appUser, {
		fields: [vendorClaim.reviewedBy],
		references: [appUser.id],
		relationName: "vendorClaim_reviewedBy_appUser_id"
	}),
}));

export const verificationRecordRelations = relations(verificationRecord, ({one}) => ({
	appUser: one(appUser, {
		fields: [verificationRecord.checkedBy],
		references: [appUser.id]
	}),
	vendor: one(vendor, {
		fields: [verificationRecord.vendorId],
		references: [vendor.id]
	}),
	mediaAsset: one(mediaAsset, {
		fields: [verificationRecord.evidenceMediaId],
		references: [mediaAsset.id]
	}),
}));

export const collectionRelations = relations(collection, ({one, many}) => ({
	appUser: one(appUser, {
		fields: [collection.curatedBy],
		references: [appUser.id]
	}),
	collectionItems: many(collectionItem),
}));

export const vendorSuggestionRelations = relations(vendorSuggestion, ({one}) => ({
	category: one(category, {
		fields: [vendorSuggestion.categoryId],
		references: [category.id]
	}),
	appUser_suggestedBy: one(appUser, {
		fields: [vendorSuggestion.suggestedBy],
		references: [appUser.id],
		relationName: "vendorSuggestion_suggestedBy_appUser_id"
	}),
	vendor: one(vendor, {
		fields: [vendorSuggestion.vendorId],
		references: [vendor.id]
	}),
	appUser_reviewedBy: one(appUser, {
		fields: [vendorSuggestion.reviewedBy],
		references: [appUser.id],
		relationName: "vendorSuggestion_reviewedBy_appUser_id"
	}),
}));

export const activityEventRelations = relations(activityEvent, ({one}) => ({
	vendor: one(vendor, {
		fields: [activityEvent.vendorId],
		references: [vendor.id]
	}),
	appUser: one(appUser, {
		fields: [activityEvent.userId],
		references: [appUser.id]
	}),
	municipality: one(municipality, {
		fields: [activityEvent.municipalityId],
		references: [municipality.id]
	}),
}));

export const vendorDailyStatsRelations = relations(vendorDailyStats, ({one}) => ({
	vendor: one(vendor, {
		fields: [vendorDailyStats.vendorId],
		references: [vendor.id]
	}),
	municipality: one(municipality, {
		fields: [vendorDailyStats.municipalityId],
		references: [municipality.id]
	}),
}));

export const statusChangeRelations = relations(statusChange, ({one}) => ({
	appUser: one(appUser, {
		fields: [statusChange.actorUserId],
		references: [appUser.id]
	}),
}));

export const auditLogRelations = relations(auditLog, ({one}) => ({
	appUser: one(appUser, {
		fields: [auditLog.actorUserId],
		references: [appUser.id]
	}),
}));

export const attributeDefinitionCategoryRelations = relations(attributeDefinitionCategory, ({one}) => ({
	attributeDefinition: one(attributeDefinition, {
		fields: [attributeDefinitionCategory.attributeDefinitionId],
		references: [attributeDefinition.id]
	}),
	category: one(category, {
		fields: [attributeDefinitionCategory.categoryId],
		references: [category.id]
	}),
}));

export const vendorServiceAreaRelations = relations(vendorServiceArea, ({one}) => ({
	vendor: one(vendor, {
		fields: [vendorServiceArea.vendorId],
		references: [vendor.id]
	}),
	municipality: one(municipality, {
		fields: [vendorServiceArea.municipalityId],
		references: [municipality.id]
	}),
}));

export const vendorCategoryRelations = relations(vendorCategory, ({one}) => ({
	vendor: one(vendor, {
		fields: [vendorCategory.vendorId],
		references: [vendor.id]
	}),
	category: one(category, {
		fields: [vendorCategory.categoryId],
		references: [category.id]
	}),
}));

export const vendorMediaRelations = relations(vendorMedia, ({one}) => ({
	vendor: one(vendor, {
		fields: [vendorMedia.vendorId],
		references: [vendor.id]
	}),
	mediaAsset: one(mediaAsset, {
		fields: [vendorMedia.mediaAssetId],
		references: [mediaAsset.id]
	}),
}));

export const collectionItemRelations = relations(collectionItem, ({one}) => ({
	collection: one(collection, {
		fields: [collectionItem.collectionId],
		references: [collection.id]
	}),
	vendor: one(vendor, {
		fields: [collectionItem.vendorId],
		references: [vendor.id]
	}),
}));