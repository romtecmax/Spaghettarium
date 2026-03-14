using System;

namespace ShapeDiver.GraphDb;

/// <summary>
/// A document version, uniquely identified by its <see cref="DocumentId"> and <see cref="VersionId"/>.
/// </summary>
public struct DocumentVersion
{
    /// <summary>
    /// The document id.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_Document_DocumentID.htm
    /// </summary>
    [DbEqualityCheck]
    public Guid DocumentId;

    /// <summary>
    /// A unique version identifier (like a commit id).
    /// For Grasshopper files this is a hash depending on the file contents.
    /// For cluster this is a hash depending on the cluster document.
    /// </summary>
    [DbEqualityCheck]
    public Guid VersionId;

    /// <summary>
    /// Name of the file, without path.
    /// Not set for clusters.
    /// </summary>
    [DbSerialize]
    public string FileName;

    /// <summary>
    /// Full path to the file.
    /// Not set for clusters.
    /// </summary>
    [DbSerialize]
    public string FilePath;

    /// <summary>
    /// True if this is a cluster document.
    /// </summary>
    [DbSerialize]
    public bool? IsCluster;

    /// <summary>
    /// Creation time of the file in UTC.
    /// Not set for clusters.
    /// </summary>
    [DbSerialize]
    public DateTime? FileCreationTimeUtc;

    /// <summary>
    /// Last write time of the file in UTC.
    /// Not set for clusters.
    /// </summary>
    [DbSerialize]
    public DateTime? FileLastWriteTimeUtc;
}